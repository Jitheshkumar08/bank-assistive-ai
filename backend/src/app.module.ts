import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, seconds } from '@nestjs/throttler';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { BranchesModule } from './branches/branches.module';
import { ContextModule } from './context/context.module';
import { AssistantModule } from './assistant/assistant.module';
import { SessionsModule } from './sessions/sessions.module';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { ThrottlerBehindProxyGuard } from './common/guards/throttler-behind-proxy.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    // Baseline limit for every route. Sensitive routes narrow it
    // further with their own named throttle.
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: seconds(60), limit: 120 }],
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    HealthModule,
    BranchesModule,
    ContextModule,
    SessionsModule,
    AssistantModule,
    AdminModule,
  ],
  providers: [
    // Authentication is the default. A route is reachable without a
    // token only when it is explicitly marked @Public(), so a new
    // endpoint added without thinking about auth is protected, not open.
    // Order matters: throttling runs before authentication, so an
    // unauthenticated flood is rejected without ever reaching argon2 or
    // the database.
    {
      provide: APP_GUARD,
      useClass: ThrottlerBehindProxyGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // Last, so it runs with an authenticated account already on the
    // request. It stands aside unless a route asks for a role.
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
