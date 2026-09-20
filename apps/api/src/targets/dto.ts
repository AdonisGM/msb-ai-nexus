import { Transform, Type } from 'class-transformer'
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Matches,
  MaxLength,
  Min,
} from 'class-validator'
import { BPS_PER_UNIT, SEGMENTS, TARGET_METRICS, TARGET_SCOPES } from '../db/schema'

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value

/** `2026-Q3`. A label rather than a date range: everyone says "quý ba", and a
 *  label groups and sorts correctly as it stands. */
const PERIOD = /^\d{4}-Q[1-4]$/

export class ListTargetsDto {
  @IsOptional()
  @Matches(PERIOD, { message: 'period_invalid' })
  period?: string

  @IsOptional()
  @IsIn(TARGET_SCOPES)
  scope?: string

  @IsOptional()
  @IsIn(TARGET_METRICS)
  metric?: string
}

export class SetTargetDto {
  @IsIn(TARGET_SCOPES, { message: 'scope_invalid' })
  scope!: string

  /** Required for a personal target, forbidden on a unit one — a unit number
   *  that also named a person would be counted twice. */
  @IsOptional()
  @IsString()
  ownerId?: string

  /** Narrows a unit target to one segment, so the two teams can be compared.
   *  Omitted means the whole unit. */
  @IsOptional()
  @IsIn(SEGMENTS)
  segment?: string

  @Matches(PERIOD, { message: 'period_invalid' })
  period!: string

  /** What is being measured. The branch runs on `cr_rate` — every report says
   *  "6% CR" — so that is the default. Money and deal-count targets exist
   *  beside it rather than instead of it, because a conversion rate says
   *  nothing about whether the deals were worth having. */
  @IsOptional()
  @IsIn(TARGET_METRICS, { message: 'metric_invalid' })
  metric?: string

  /** In the unit its metric implies: basis points for `cr_rate` (600 = 6%),
   *  a count for `deals`, whole đồng for `value`.
   *
   *  Basis points rather than a decimal so the gap arithmetic stays in
   *  integers — a rate stored as a float turns "did we hit 6%" into a question
   *  about rounding. The upper bound is checked in the service, where the
   *  metric is known. */
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'amount_must_be_positive' })
  @Max(BPS_PER_UNIT * 1_000_000_000_000, { message: 'amount_too_large' })
  amount!: number

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string
}
