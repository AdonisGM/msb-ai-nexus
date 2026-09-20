import { Transform } from 'class-transformer'
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator'

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value)

export class StartConversationDto {
  /** What the thread is about, so reopening the assistant from a customer file
   *  comes back to the same thread. Both fields or neither — the database
   *  refuses half a reference, and so does this. */
  @IsOptional()
  @IsIn(['customer', 'opportunity'], { message: 'subject_kind_invalid' })
  subjectKind?: string

  @ValidateIf((body: StartConversationDto) => body.subjectKind !== undefined)
  @IsString()
  @IsNotEmpty({ message: 'subject_id_required' })
  subjectId?: string
}

export class SendMessageDto {
  /** Capped well above anything a person types and well below anything that
   *  would be a paste of a whole report. */
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'text_required' })
  @MaxLength(4000, { message: 'text_too_long' })
  text!: string
}

export class DecideToolCallDto {
  /** The person's words when they decline, shown back to the assistant so it
   *  adapts instead of proposing the same write again. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string
}
