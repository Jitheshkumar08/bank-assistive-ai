import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common'
import {
  ApiAcceptedResponse, ApiBadRequestResponse, ApiCookieAuth, ApiForbiddenResponse, ApiNoContentResponse, ApiOkResponse,
  ApiOperation, ApiServiceUnavailableResponse, ApiTags, ApiTooManyRequestsResponse, ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { ErrorResponseDto } from '../common/api-error.js'
import { RateLimit } from '../common/rate-limit.js'
import { rateLimits } from '../config/app-config.service.js'
import { AuthService } from './auth.service.js'
import {
  EmailDto, LoginDto, LoginResponseDto, MessageResponseDto, RegisterDto, ResetPasswordDto, ResetPasswordResponseDto,
  StudentResponseDto, TokenDto, VerifyEmailResponseDto,
} from './dto/auth.dto.js'
import { CurrentStudent, SessionGuard } from './session.guard.js'
import { SessionService, type AuthenticatedStudent } from './session.service.js'

const FIFTEEN_MINUTES = 15 * 60 * 1000
const authLimit = { limit: () => rateLimits.auth, windowMs: FIFTEEN_MINUTES }
const emailLimit = { limit: () => rateLimits.email, windowMs: FIFTEEN_MINUTES }

@ApiTags('auth')
@Controller('auth')
@ApiTooManyRequestsResponse({ type: ErrorResponseDto, description: 'Rate limited (RATE_LIMITED).' })
@ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Validation failed (VALIDATION_FAILED, with details).' })
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly sessions: SessionService) {}

  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit(emailLimit)
  @ApiOperation({ summary: 'Register a student account (sends a verification email)', description: 'Always answers with the same message, whether or not the email is already registered.' })
  @ApiAcceptedResponse({ type: MessageResponseDto })
  @ApiServiceUnavailableResponse({ type: ErrorResponseDto, description: 'EMAIL_PROVIDER_NOT_CONFIGURED or EMAIL_DELIVERY_FAILED — nothing is reported as sent.' })
  register(@Body() body: RegisterDto) {
    return this.auth.register(body)
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit(emailLimit)
  @ApiOperation({ summary: 'Send a new verification link to an unverified account' })
  @ApiAcceptedResponse({ type: MessageResponseDto })
  @ApiServiceUnavailableResponse({ type: ErrorResponseDto })
  resendVerification(@Body() body: EmailDto) {
    return this.auth.resendVerification(body.email)
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @RateLimit(authLimit)
  @ApiOperation({ summary: 'Confirm an email address with the single-use token from the email link' })
  @ApiOkResponse({ type: VerifyEmailResponseDto })
  verifyEmail(@Body() body: TokenDto) {
    return this.auth.verifyEmail(body.token)
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @RateLimit(authLimit)
  @ApiOperation({ summary: 'Sign in; sets the HttpOnly session cookie', description: 'Only verified, active accounts can sign in.' })
  @ApiOkResponse({ type: LoginResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'INVALID_CREDENTIALS (same for unknown email and wrong password).' })
  @ApiForbiddenResponse({ type: ErrorResponseDto, description: 'EMAIL_NOT_VERIFIED or ACCOUNT_DISABLED (only after a correct password).' })
  async login(@Body() body: LoginDto, @Res({ passthrough: true }) response: Response) {
    const { session, student } = await this.auth.login(body)
    response.cookie(this.sessions.cookieName, session.token, this.sessions.cookieOptions(session.expiresAt))
    return { student, expiresAt: session.expiresAt.toISOString() }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Sign out: revokes this session and clears the cookie (idempotent)' })
  @ApiNoContentResponse()
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(request.cookies?.[this.sessions.cookieName])
    response.clearCookie(this.sessions.cookieName, this.sessions.cookieOptions())
  }

  @Get('me')
  @UseGuards(SessionGuard)
  @ApiCookieAuth('session')
  @ApiOperation({ summary: 'The signed-in student' })
  @ApiOkResponse({ type: StudentResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'UNAUTHENTICATED' })
  me(@CurrentStudent() student: AuthenticatedStudent) {
    return this.auth.currentStudent(student.id)
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit(emailLimit)
  @ApiOperation({ summary: 'Request a password reset link', description: 'Always answers with the same message.' })
  @ApiAcceptedResponse({ type: MessageResponseDto })
  @ApiServiceUnavailableResponse({ type: ErrorResponseDto })
  forgotPassword(@Body() body: EmailDto) {
    return this.auth.forgotPassword(body.email)
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @RateLimit(authLimit)
  @ApiOperation({ summary: 'Set a new password with the single-use reset token; signs out every session' })
  @ApiOkResponse({ type: ResetPasswordResponseDto })
  resetPassword(@Body() body: ResetPasswordDto) {
    return this.auth.resetPassword(body)
  }
}
