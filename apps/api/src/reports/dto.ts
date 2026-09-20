import { Transform } from 'class-transformer'
import { IsIn, IsOptional, IsString, Matches } from 'class-validator'
import { SEGMENTS } from '../db/schema'

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value

/** The window and the slice every report takes.
 *
 *  No `period` shorthand like "quý này": the screen knows what quarter it is
 *  showing and can say so in dates. A server that resolved "quý này" itself
 *  would resolve it in its own timezone, which is not necessarily the one the
 *  person reading it lives in. */
export class ReportQuery {
  /** YYYY-MM-DD, inclusive both ends. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from_invalid' })
  from?: string

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to_invalid' })
  to?: string

  @IsOptional()
  @IsIn(SEGMENTS)
  segment?: string

  @IsOptional()
  @Transform(trim)
  @IsString()
  ownerId?: string
}
