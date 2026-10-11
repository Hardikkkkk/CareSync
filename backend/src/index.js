require('dotenv').config();
const { ApolloServer, gql } = require('apollo-server');
const { PrismaClient } = require('@prisma/client');
const { subDays } = require('date-fns');

const prisma = new PrismaClient();

// CHANGED: allowed websites come from the FRONTEND_URLS setting (comma separated),
// so you can add your Vercel link without editing code.
// Example: FRONTEND_URLS=https://caresync.vercel.app,https://www.mysite.com
const allowedOrigins = [
  'http://localhost:3000', // local dev
  ...(process.env.FRONTEND_URLS || '')
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean),
];

// India time (UTC+5:30). Render's servers run in UTC, so "today" must be worked out in IST.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function startOfTodayIST() {
  const d = new Date(Date.now() + IST_OFFSET_MS);
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() - IST_OFFSET_MS);
}

// GraphQL schema
const typeDefs = gql`
  type User {
    id: Int!
    name: String!
    email: String!
    role: String!
  }

  type ClockEvent {
    id: Int!
    type: String!
    note: String
    latitude: Float!
    longitude: Float!
    timestamp: String!
    user: User!
  }

  type DailyClockIn {
    date: String!
    count: Int!
  }

  type StaffStats {
    userId: Int!
    name: String!
    totalHoursLastWeek: Float!
    avgDailyHours: Float!
    daysPresent: Int!
  }

  type Setting {
    id: Int!
    name: String!
    value: String!
  }

  type Query {
    ping: Boolean!
    users: [User!]!
    clockEvents(userId: Int!, limit: Int): [ClockEvent!]!
    todayClockIns: [ClockEvent!]!
    currentlyClockedIn: [User!]!
    dailyClockInCount: [DailyClockIn!]!
    staffClockStats: [StaffStats!]!
    getUserByEmail(email: String!): User
    getSetting(name: String!): Setting
  }

  type Mutation {
    createUser(name: String!, email: String!, role: String!): User!
    updateUserRole(userId: Int!, role: String!): User!
    deleteUser(userId: Int!): Boolean!
    clockIn(userId: Int!, note: String, latitude: Float!, longitude: Float!): ClockEvent!
    clockOut(userId: Int!, note: String, latitude: Float!, longitude: Float!): ClockEvent!
    createUserIfNotExists(name: String!, email: String!): User!
    updateSetting(name: String!, value: String!): Setting!
  }
`;

const resolvers = {
  Query: {
    // NEW: touches the database, so the frontend can wake Neon up early
    ping: async () => {
      await prisma.$queryRaw`SELECT 1`;
      return true;
    },

    getSetting: (_, { name }) => prisma.setting.findUnique({ where: { name } }),
    users: () => prisma.user.findMany(),

    // CHANGED: newest first, and an optional limit
    clockEvents: (_, { userId, limit }) =>
      prisma.clockEvent.findMany({
        where: { userId },
        orderBy: { timestamp: 'desc' },
        ...(limit ? { take: limit } : {}),
      }),

    // NEW: the manager dashboard asks for this. Every event since midnight IST.
    todayClockIns: () =>
      prisma.clockEvent.findMany({
        where: { timestamp: { gte: startOfTodayIST() } },
        orderBy: { timestamp: 'desc' },
      }),

    // CHANGED: uses each person's latest event from the last 24 hours, so night
    // shifts that started yesterday still show up as "on shift"
    currentlyClockedIn: async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const users = await prisma.user.findMany({
        include: {
          clockEvents: {
            where: { timestamp: { gte: since } },
            orderBy: { timestamp: 'desc' },
            take: 1,
          },
        },
      });
      return users.filter((u) => u.clockEvents[0]?.type === 'IN');
    },

    dailyClockInCount: async (_, __, { prisma }) => {
      const result = await prisma.$queryRaw`
        SELECT 
          TO_CHAR((timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS date,
          COUNT(DISTINCT "userId")::int AS count
        FROM "ClockEvent"
        WHERE type = 'IN'
          AND (timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata') >= (CURRENT_DATE - interval '6 days')
        GROUP BY date
        ORDER BY date DESC;
      `;

      // Reverse to show oldest first
      return result
        .map((r) => ({ date: r.date, count: Number(r.count) }))
        .reverse();
    },

    // CHANGED: one database query instead of one per person (much faster),
    // and the average is 0 (not 1) when someone has no shifts
    staffClockStats: async () => {
      const users = await prisma.user.findMany();
      const weekAgo = subDays(new Date(), 7);

      const all = await prisma.clockEvent.findMany({
        where: { timestamp: { gte: weekAgo } },
        orderBy: { timestamp: 'asc' },
      });
      const byUser = {};
      all.forEach((e) => {
        if (!byUser[e.userId]) byUser[e.userId] = [];
        byUser[e.userId].push(e);
      });

      return users.map((user) => {
        const events = byUser[user.id] || [];
        let totalHours = 0;
        const dailyLogs = {};

        for (let i = 0; i < events.length; i++) {
          if (events[i].type === 'IN' && events[i + 1]?.type === 'OUT') {
            const inTime = new Date(events[i].timestamp);
            const outTime = new Date(events[i + 1].timestamp);
            const hours = (outTime - inTime) / (1000 * 60 * 60);
            totalHours += hours;

            const day = new Date(inTime.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
            dailyLogs[day] = (dailyLogs[day] || 0) + hours;
            i++; // skip next OUT event
          }
        }

        const days = Object.keys(dailyLogs).length;
        return {
          userId: user.id,
          name: user.name,
          totalHoursLastWeek: parseFloat(totalHours.toFixed(2)),
          avgDailyHours: days ? parseFloat((totalHours / days).toFixed(2)) : 0,
          daysPresent: days,
        };
      });
    },

    getUserByEmail: async (_, { email }) => {
      return prisma.user.findUnique({ where: { email } });
    },
  },

  Mutation: {
    createUserIfNotExists: async (_, { name, email }) => {
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) return existingUser;

      return prisma.user.create({
        data: {
          name,
          email,
          role: 'careworker',
        },
      });
    },

    createUser: (_, args) => prisma.user.create({ data: args }),

    updateUserRole: async (_, { userId, role }) => {
      return prisma.user.update({
        where: { id: userId },
        data: { role },
      });
    },

    deleteUser: async (_, { userId }) => {
      await prisma.user.delete({ where: { id: userId } });
      return true;
    },

    clockIn: (_, { userId, note, latitude, longitude }) =>
      prisma.clockEvent.create({
        data: { userId, note, type: 'IN', latitude, longitude },
      }),

    clockOut: async (_, { userId, note, latitude, longitude }) => {
      try {
        return await prisma.clockEvent.create({
          data: { userId, note, type: 'OUT', latitude, longitude },
        });
      } catch (error) {
        console.error('❌ Error during clockOut:', error);
        throw new Error('Failed to clock out.');
      }
    },

    updateSetting: async (_, { name, value }) => {
      return prisma.setting.upsert({
        where: { name },
        update: { value },
        create: { name, value },
      });
    },
  },

  ClockEvent: {
    user: (parent) => prisma.user.findUnique({ where: { id: parent.userId } }),
  },
};

// Test database connection function
async function testDatabaseConnection() {
  try {
    await prisma.$connect();
    console.log('✅ Database connected successfully');
    const userCount = await prisma.user.count();
    console.log(`📊 Database has ${userCount} users`);
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    process.exit(1);
  }
}

// Start server function
async function startServer() {
  try {
    console.log('🚀 Starting server...');
    console.log('📍 Environment:', process.env.NODE_ENV || 'development');
    console.log('🔗 Port:', process.env.PORT || 4000);

    await testDatabaseConnection();

    const server = new ApolloServer({
      typeDefs,
      resolvers,
      context: () => ({ prisma }),
      cors: {
        origin: function (origin, callback) {
          // Allow requests with no origin (mobile apps, server-to-server)
          if (!origin) return callback(null, true);

          if (allowedOrigins.includes(origin)) {
            callback(null, true);
          } else {
            console.log('❌ Origin blocked:', origin, '| allowed:', allowedOrigins.join(', '));
            callback(null, false);
          }
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: [
          'Origin',
          'X-Requested-With',
          'Content-Type',
          'Accept',
          'Authorization',
          'Apollo-Require-Preflight',
        ],
      },
      introspection: true,
      playground: process.env.NODE_ENV !== 'production',
      formatError: (err) => {
        console.error('GraphQL Error:', err);
        return {
          message: err.message,
          locations: err.locations,
          path: err.path,
        };
      },
    });

    const { url } = await server.listen({
      port: process.env.PORT || 4000,
      host: '0.0.0.0', // Important for Render deployment
    });

    console.log('🎉 Server ready at:', url);
    console.log('📱 Allowed origins:', allowedOrigins.join(', '));
  } catch (error) {
    console.error('💥 Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM received, shutting down gracefully');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🛑 SIGINT received, shutting down gracefully');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

// Start the server
startServer();