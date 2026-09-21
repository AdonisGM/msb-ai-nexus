import { Transform } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator'

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
   *  would be a paste of a whole report — a report belongs in an attachment.
   *
   *  Optional because a file can be the whole message; the service refuses a
   *  turn with neither. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(4000, { message: 'text_too_long' })
  text?: string

  /** Files uploaded to this thread beforehand, in the order they were added.
   *  The count is checked again by the service, alongside ownership and size. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5, { message: 'attachment_too_many' })
  @IsString({ each: true })
  attachmentIds?: string[]

  /** The record on screen when the message was sent, if the person left it
   *  attached. Only the reference travels: the server reads the record through
   *  the person's own scope and writes the name itself, so nothing the browser
   *  claims about the record reaches the model. */
  @IsOptional()
  @IsIn(['customer', 'opportunity'], { message: 'context_kind_invalid' })
  contextKind?: 'customer' | 'opportunity'

  @ValidateIf((body: SendMessageDto) => body.contextKind !== undefined)
  @IsString()
  @IsNotEmpty({ message: 'context_id_required' })
  contextId?: string
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
