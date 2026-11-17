import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator'
import { ASSISTANT_LANGUAGES, type AssistantLanguage } from './assistant.contract.js'

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value)

/**
 * One chat message from the Student Portal. Carries the question, the selected language and the scanned college context
 * only. Identity, rank, category, admission status or any other student field is NOT accepted: the strict validation
 * pipe rejects unknown properties with 400 VALIDATION_FAILED, and student data is always read from the session's own
 * official record on the server.
 */
export class AssistantMessageDto {
  @ApiProperty({ example: 'What is my admission status?', minLength: 1, maxLength: 500 })
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(500)
  message: string

  @ApiProperty({ enum: ASSISTANT_LANGUAGES, example: 'en' })
  @IsIn(ASSISTANT_LANGUAGES)
  language: AssistantLanguage

  @ApiProperty({ example: 'nmamit', description: 'College from the scanned QR code; re-checked on every message.' })
  @IsString() @Matches(/^[a-z0-9][a-z0-9-]{1,39}$/, { message: 'collegeId is invalid' })
  collegeId: string

  @ApiPropertyOptional({ example: 'admissions-desk', nullable: true, description: 'QR placement (location) from the scan; re-checked.' })
  @IsOptional() @IsString() @Matches(/^[a-z0-9][a-z0-9-]{0,39}$/, { message: 'area is invalid' })
  area?: string | null

  @ApiPropertyOptional({ enum: ['text', 'voice'] })
  @IsOptional() @IsIn(['text', 'voice'])
  inputMode?: 'text' | 'voice'

  @ApiPropertyOptional({
    description: 'Accepted for compatibility with the Student Portal and IGNORED: the conversation history the assistant '
      + 'uses is kept server-side by the language engine, so a client-supplied history can never change it.',
    type: 'array', items: { type: 'object' },
  })
  @IsOptional() @IsArray() @ArrayMaxSize(100)
  history?: unknown[]
}

/**
 * The form fields that come with a spoken question (multipart/form-data, the recording in the `audio` file part).
 * The same context rules as AssistantMessageDto: language and scanned college context only — no identity or student
 * field is accepted (the strict validation pipe refuses unknown fields with 400).
 */
export class AssistantVoiceDto {
  @ApiProperty({ enum: ASSISTANT_LANGUAGES, example: 'en', description: 'The language the student speaks and wants the answer in.' })
  @IsIn(ASSISTANT_LANGUAGES)
  language: AssistantLanguage

  @ApiProperty({ example: 'nmamit', description: 'College from the scanned QR code; re-checked on every question.' })
  @IsString() @Matches(/^[a-z0-9][a-z0-9-]{1,39}$/, { message: 'collegeId is invalid' })
  collegeId: string

  @ApiPropertyOptional({ example: 'admissions-desk', description: 'QR placement (location) from the scan; re-checked.' })
  @IsOptional() @IsString() @Matches(/^[a-z0-9][a-z0-9-]{0,39}$/, { message: 'area is invalid' })
  area?: string
}

/** Reads one assistant reply aloud. Only a reply this session was actually given can be spoken. */
export class AssistantSpeechDto {
  @ApiProperty({ minLength: 1, maxLength: 2000 })
  @IsString() @MinLength(1) @MaxLength(2000)
  text: string
}

export class AssistantStudentContextDto {
  @ApiProperty({ example: true, description: 'The record was matched to the signed-in account by its verified email.' }) verified: true
  @ApiProperty({ type: Number, nullable: true }) admissionYear: number | null
  @ApiProperty({ type: Number, nullable: true, description: 'Null until ranks are published.' }) rank: number | null
  @ApiProperty({ type: String, nullable: true, description: 'Always null: no trusted source for the admission category.' }) category: null
  @ApiProperty({ type: String, nullable: true, description: 'Null until a branch is allocated.' }) allocatedBranch: string | null
  @ApiProperty({ type: String, nullable: true, description: 'Always null: batches are not in the data model yet.' }) assignedBatch: null
  @ApiProperty({ type: String, nullable: true, description: 'Always null: admission halls are not in the data model yet.' }) assignedHall: null
  @ApiProperty({ type: String, nullable: true, description: 'Status text exactly as published officially.' }) admissionStatus: string | null
  @ApiProperty({ type: String, nullable: true, description: 'Always null: next steps are not in the data model yet.' }) nextStep: null
}

export class AssistantReplyDto {
  @ApiProperty({ description: 'The reply, in the requested language.' }) text: string
  @ApiProperty({ enum: ASSISTANT_LANGUAGES }) language: AssistantLanguage
  @ApiProperty({ type: String, nullable: true }) intent: string | null
  @ApiProperty({ type: String, nullable: true }) outcome: string | null
  @ApiProperty({ type: [String], nullable: true, description: 'Step-by-step list (e.g. verified directions).' }) steps: string[] | null
  @ApiProperty({ type: AssistantStudentContextDto, nullable: true, description: 'Only after an admission-status lookup that found the student’s own record.' })
  studentContext: AssistantStudentContextDto | null
  @ApiPropertyOptional({ description: 'Spoken questions only: what was heard, in the student’s own words.' })
  transcript?: string
}
