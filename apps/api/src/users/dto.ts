import { Transform, Type } from 'class-transformer'
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator'
import { LEVELS, ROLES, SEGMENTS } from '../db/schema'

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value

/** Login handles and staff numbers are typed by hand off a spreadsheet, so
 *  they are upper-cased on the way in. A branch that ends up with both
 *  `nv0006` and `NV0006` has two people who are one person. */
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value

/** Eight characters, which is the floor rather than the aim. The accounts are
 *  handed out in person for a trial run and then changed. */
const MIN_PASSWORD = 8

export class CreateUserDto {
  @Transform(upper)
  @IsString()
  @IsNotEmpty({ message: 'code_required' })
  @Matches(/^[A-Z0-9-]+$/, { message: 'code_invalid' })
  @MaxLength(40)
  code!: string

  @Transform(upper)
  @IsString()
  @IsNotEmpty({ message: 'employee_code_required' })
  @Matches(/^[A-Z0-9-]+$/, { message: 'employee_code_invalid' })
  @MaxLength(40)
  employeeCode!: string

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'name_required' })
  @MaxLength(120)
  name!: string

  @IsIn(ROLES, { message: 'role_invalid' })
  role!: string

  @Transform(trim)
  @IsString()
  @IsNotEmpty({ message: 'title_required' })
  @MaxLength(120)
  title!: string

  @IsString()
  @MinLength(MIN_PASSWORD, { message: 'password_too_short' })
  @MaxLength(200)
  password!: string

  /** Required for a salesperson or team lead, refused for the other two. The
   *  service says which, because the rule depends on `role`. */
  @IsOptional()
  @IsIn(SEGMENTS, { message: 'segment_invalid' })
  segment?: string

  @IsOptional()
  @IsString()
  managerId?: string

  @IsOptional()
  @IsIn(LEVELS, { message: 'level_invalid' })
  level?: string

  @IsOptional()
  @Transform(trim)
  @IsEmail({}, { message: 'email_invalid' })
  email?: string

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(30)
  phone?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sort?: number
}

/** Everything a person's record can be corrected to.
 *
 *  `unitId` is absent on purpose: moving somebody between branches moves their
 *  whole book with them, which is a transfer rather than an edit and deserves
 *  its own thinking. The password is absent too — it has its own endpoint, so
 *  a careless PATCH can never reset one by accident. */
export class UpdateUserDto {
  @IsOptional()
  @Transform(upper)
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z0-9-]+$/, { message: 'code_invalid' })
  @MaxLength(40)
  code?: string

  @IsOptional()
  @Transform(upper)
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z0-9-]+$/, { message: 'employee_code_invalid' })
  @MaxLength(40)
  employeeCode?: string

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string

  @IsOptional()
  @IsIn(ROLES, { message: 'role_invalid' })
  role?: string

  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title?: string

  /** `null` clears it, which is how a branch manager or an admin is corrected
   *  back out of a segment they were given by mistake. */
  @IsOptional()
  @IsIn([...SEGMENTS, null], { message: 'segment_invalid' })
  segment?: string | null

  @IsOptional()
  @IsIn([...LEVELS, null], { message: 'level_invalid' })
  level?: string | null

  @IsOptional()
  managerId?: string | null

  @IsOptional()
  @Transform(({ value }) => (value === null || value === '' ? null : trim({ value })))
  email?: string | null

  @IsOptional()
  @Transform(({ value }) => (value === null || value === '' ? null : trim({ value })))
  @MaxLength(30)
  phone?: string | null

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sort?: number

  @IsOptional()
  @IsBoolean()
  active?: boolean
}

/** An admin handing somebody a new password.
 *
 *  No current password is asked for, because the admin does not know it — that
 *  is the point of a reset. The account is signed out everywhere as a
 *  consequence, which the service does rather than the caller remembering to. */
export class SetPasswordDto {
  @IsString()
  @MinLength(MIN_PASSWORD, { message: 'password_too_short' })
  @MaxLength(200)
  password!: string
}
