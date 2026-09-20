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
  ValidateNested,
} from 'class-validator'
import {
  BLOCKER_CODES,
  LEAD_SOURCES,
  OUTCOMES,
  PRODUCTS,
  SEGMENTS,
  STAGES,
} from '../db/schema'

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value

/** Query strings arrive as text; a checkbox filter has to survive the trip. */
const flag = ({ value }: { value: unknown }) => value === 'true' || value === true

export class ListOpportunitiesDto {
  /** Free text over the lead and the customer it hangs off. People look for a
   *  lead by the customer's name far more often than by its code. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string

  @IsOptional()
  @IsIn(SEGMENTS)
  segment?: string

  @IsOptional()
  @IsIn(STAGES)
  stage?: string

  @IsOptional()
  @IsIn(OUTCOMES)
  outcome?: string

  @IsOptional()
  @IsIn(PRODUCTS)
  product?: string

  @IsOptional()
  @IsIn(LEAD_SOURCES)
  source?: string

  @IsOptional()
  @IsIn(BLOCKER_CODES)
  blockerCode?: string

  @IsOptional()
  @IsString()
  ownerId?: string

  @IsOptional()
  @IsString()
  customerId?: string

  /** Only the caller's own book. */
  @IsOptional()
  @Transform(flag)
  mine?: boolean

  /** Nobody has called these yet — what a team lead chases. */
  @IsOptional()
  @Transform(flag)
  untouched?: boolean

  /** Landed, nobody has checked it against the paperwork. */
  @IsOptional()
  @Transform(flag)
  awaitingConfirm?: boolean

  @IsOptional()
  @Transform(flag)
  confirmed?: boolean

  /** Past its date and still open. A lead closed late is not overdue, it is
   *  finished. */
  @IsOptional()
  @Transform(flag)
  overdue?: boolean

  /** Nothing has happened to it for this many days. What a team lead chases. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3650)
  staleDays?: number

  /** What the list is ordered by, which decides what the person looking at it
   *  does first. `due` runs a salesperson's day; `stale` runs the chasing. */
  @IsOptional()
  @IsIn(['due', 'stale', 'value', 'recent'], { message: 'sort_invalid' })
  sort?: string

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

export class CreateOpportunityDto {
  @IsString()
  @IsNotEmpty({ message: 'customer_required' })
  customerId!: string

  @IsIn(PRODUCTS, { message: 'product_required' })
  product!: string

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'need_required' })
  @MaxLength(500)
  need!: string

  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'value_must_be_positive' })
  value!: number

  /** Where it came in from. A bulk upload says `import`; a salesperson who
   *  found the customer themselves leaves it alone. */
  @IsOptional()
  @IsIn(LEAD_SOURCES)
  source?: string

  /** YYYY-MM-DD. A deadline is a day, not an instant. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'due_date_invalid' })
  dueDate?: string

  @IsOptional()
  @IsIn(BLOCKER_CODES)
  blockerCode?: string

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  blockerNote?: string

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  nextAction?: string

  @IsOptional()
  @IsObject()
  confirmedData?: Record<string, unknown>

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  missingInfo?: string[]
}

/** Editing never changes the customer, the owner or the funnel: the first
 *  would move a lead into another segment's numbers, the second is a handover
 *  and has its own endpoint, and the third is only ever a consequence of
 *  pressing a button. */
export class UpdateOpportunityDto {
  @IsOptional()
  @IsIn(PRODUCTS)
  product?: string

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  need?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'value_must_be_positive' })
  value?: number

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'due_date_invalid' })
  dueDate?: string

  @IsOptional()
  @IsIn(BLOCKER_CODES)
  blockerCode?: string

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  blockerNote?: string

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  nextAction?: string

  @IsOptional()
  @IsObject()
  confirmedData?: Record<string, unknown>

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  missingInfo?: string[]

  /** Why the edit was made. Optional here — the approval moves are where a
   *  reason is compulsory. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  reason?: string
}

/** One product a deal actually sold, with what it was worth.
 *
 *  `amount` may be zero — a fee-free card is a real sale the branch counts —
 *  but never absent, because the report sums this column and a missing figure
 *  would silently read as nothing. */
export class SoldProductDto {
  @IsIn(PRODUCTS)
  product!: string

  @Type(() => Number)
  @IsInt()
  @Min(0, { message: 'amount_must_not_be_negative' })
  amount!: number

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string
}

/** The body behind a button. Which fields matter depends on the button, and
 *  the service says so rather than the shape: `win` needs a reason and what
 *  was sold, `confirm` carries the team lead's note from the file. */
export class ActDto {
  /** Why. Compulsory on the moves that change what the branch reports — the
   *  service decides which, so this stays optional here. */
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  reason?: string

  /** What was sold. Required on `win` and ignored everywhere else. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SoldProductDto)
  products?: SoldProductDto[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  missingInfo?: string[]

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  nextAction?: string

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'due_date_invalid' })
  dueDate?: string

  @IsOptional()
  @IsIn(BLOCKER_CODES)
  blockerCode?: string

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  blockerNote?: string
}

/** Handing a lead to someone else. Admin only, and the service checks the
 *  recipient is in the sales line and in the same segment. */
export class AssignOpportunityDto {
  @IsString()
  @IsNotEmpty({ message: 'owner_required' })
  ownerId!: string
}
