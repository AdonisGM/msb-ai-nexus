import { Transform, Type } from 'class-transformer'
import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator'
import { SEGMENTS } from '../db/schema'

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value

export class ListCustomersDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string

  @IsOptional()
  @IsIn(SEGMENTS)
  segment?: string

  /** Narrows to one salesperson's book. A team lead uses it to look at one of
   *  their people; anyone outside the caller's own scope simply returns
   *  nothing, because the scope still applies on top. */
  @IsOptional()
  @IsString()
  ownerId?: string

  /** One value from `GET /customers/facets`. Free text, typed by hand, so it
   *  is matched exactly rather than validated against a list that does not
   *  exist. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  relationStage?: string

  /** An MSB product the customer already holds. Also from `facets`. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  product?: string

  /** Customers with at least one lead standing this way. "At least one" — a
   *  customer is not won or lost, their leads are. */
  @IsOptional()
  @IsIn(['untouched', 'open', 'won', 'lost'], { message: 'has_lead_invalid' })
  hasLead?: string

  /** Which date the window below applies to. */
  @IsOptional()
  @IsIn(['lastSignalAt', 'createdAt', 'updatedAt'], { message: 'date_field_invalid' })
  dateField?: string

  /** YYYY-MM-DD, inclusive both ends. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'from_invalid' })
  from?: string

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'to_invalid' })
  to?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number
}

export class CreateCustomerDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'name_required' })
  @MaxLength(200)
  name!: string

  @IsIn(SEGMENTS, { message: 'segment_invalid' })
  segment!: string

  /** Defaults to the caller. A team lead or branch manager may name one of
   *  their own people instead. */
  @IsOptional()
  @IsString()
  ownerId?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  currentProducts?: string[]

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  revenue?: number

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  relationStage?: string

  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  contactName?: string

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  contactPhone?: string

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  note?: string
}

/** Everything optional, and `segment` deliberately absent: moving a customer
 *  between segments would strand their open deals in the other pipeline, so it
 *  is not something an edit form gets to do by accident. */
export class UpdateCustomerDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'name_required' })
  @MaxLength(200)
  name?: string

  @IsOptional()
  @IsString()
  ownerId?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  currentProducts?: string[]

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  revenue?: number

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  relationStage?: string

  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  contactName?: string

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  contactPhone?: string

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  note?: string
}
