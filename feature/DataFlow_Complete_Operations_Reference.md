# DataFlow — Complete Data Cleaning & Preprocessing Operations Reference

This document contains the complete proposed operation library for DataFlow, including the operations that already exist and the additional operations discussed for expansion.

The goal is to make DataFlow a production-grade **No-Code Data Cleaning & Preprocessing Platform** where users can visually build a pipeline without writing Python.

---

# 1. MISSING DATA

## 1.1 Fill Missing — EXISTING

### What it does
Fills missing/null values in selected columns using a chosen strategy.

### Common strategies
- Mean
- Median
- Mode
- Constant value

### Example

Before:

| Name | Age |
|---|---:|
| John | 22 |
| Sara | null |
| Mike | 30 |

Using median:

| Name | Age |
|---|---:|
| John | 22 |
| Sara | 26 |
| Mike | 30 |

### Recommended configuration
- Column(s)
- Strategy
- Replacement value when using constant
- Optional indicator column

---

## 1.2 Drop Missing Rows — EXISTING

### What it does
Removes rows containing missing/null values.

### Example

Before:

| Name | Age |
|---|---:|
| John | 22 |
| Sara | null |
| Mike | 30 |

After:

| Name | Age |
|---|---:|
| John | 22 |
| Mike | 30 |

### Recommended configuration
- Selected columns or all columns
- Any-column-null vs all-columns-null
- Optional threshold for minimum non-null values

---

## 1.3 Forward Fill — NEW

### What it does
Fills missing values using the previous available value.

### Example

Before:

| Date | Temperature |
|---|---:|
| Jan 1 | 25 |
| Jan 2 | null |
| Jan 3 | null |
| Jan 4 | 28 |

After:

| Date | Temperature |
|---|---:|
| Jan 1 | 25 |
| Jan 2 | 25 |
| Jan 3 | 25 |
| Jan 4 | 28 |

### Best use cases
- Time-series data
- Sensor data
- Financial records
- Status histories
- Event logs

### Recommended configuration
- Column(s)
- Optional fill limit

Example:

`limit = 2` means a value may fill at most two consecutive missing cells.

---

## 1.4 Backward Fill — NEW

### What it does
Fills a missing value using the next available value.

### Example

Before:

| City |
|---|
| Dhaka |
| null |
| null |
| Chittagong |

After:

| City |
|---|
| Dhaka |
| Chittagong |
| Chittagong |
| Chittagong |

### Best use cases
- Time-series data
- Metadata propagation
- Event logs
- Datasets where the next observation is more representative

### Recommended configuration
- Column(s)
- Optional fill limit

---

## 1.5 Remove Empty Rows — NEW

### What it does
Removes rows where every relevant field is empty/null/blank.

### Example

Before:

| Name | Age | City |
|---|---:|---|
| John | 22 | Dhaka |
| null | null | null |
| Sara | 25 | Sylhet |

After:

| Name | Age | City |
|---|---:|---|
| John | 22 | Dhaka |
| Sara | 25 | Sylhet |

### Why it is different from Drop Missing Rows
`Drop Missing Rows` removes rows containing missing values according to a chosen rule.

`Remove Empty Rows` specifically targets rows that are completely empty.

### Recommended configuration
- Treat null as empty
- Treat empty string as empty
- Treat whitespace-only string as empty

---

## 1.6 Remove Empty Columns — NEW

### What it does
Removes columns that contain no meaningful data.

### Example

Before:

| Name | Age | Phone | Notes |
|---|---:|---|---|
| John | 22 | 017... | null |
| Sara | 25 | 018... | null |

After:

| Name | Age | Phone |
|---|---:|---|
| John | 22 | 017... |
| Sara | 25 | 018... |

### Best use cases
- Messy Excel exports
- CSV exports with unused columns
- Automatically generated reports
- Data imported from spreadsheets

---

# 2. ROWS

## 2.1 Drop Duplicates — EXISTING

### What it does
Removes duplicate rows.

### Example

Before:

| Name | Age |
|---|---:|
| John | 22 |
| Sara | 25 |
| John | 22 |

After:

| Name | Age |
|---|---:|
| John | 22 |
| Sara | 25 |

### Recommended configuration
- Compare all columns or selected columns
- Keep first
- Keep last
- Keep none

---

## 2.2 Filter Rows — EXISTING

### What it does
Keeps only rows matching a condition.

### Example

Condition:

`Age > 18`

Before:

| Name | Age |
|---|---:|
| John | 17 |
| Sara | 25 |
| Mike | 31 |

After:

| Name | Age |
|---|---:|
| Sara | 25 |
| Mike | 31 |

### Recommended operators
- Equals
- Not equals
- Greater than
- Less than
- Greater/equal
- Less/equal
- Contains
- Starts with
- Ends with
- Is null
- Is not null
- Between

---

## 2.3 Sort Rows — EXISTING

### What it does
Orders rows by one or more columns.

### Examples
- Age ascending
- Salary descending
- Date ascending

### Recommended configuration
- Column(s)
- Ascending/descending
- Null placement

---

## 2.4 Remove Outliers — EXISTING

### What it does
Identifies and removes extreme numeric values.

### Common method
IQR-based detection.

### Example

Values:

`20, 21, 22, 24, 25, 25, 180`

The value `180` may be flagged as an outlier.

### Recommended configuration
- Column(s)
- IQR or other supported method
- Threshold
- Remove rows vs mark rows

---

# 3. VALUES

## 3.1 Replace Values — NEW

### What it does
Replaces an exact value with another value.

### Example

Before:

| Gender |
|---|
| M |
| Male |
| male |
| F |
| Female |

Replace:

`M -> Male`

### Other examples
- `N/A -> null`
- `- -> null`
- `USA -> United States`
- `US -> United States`
- `unknown -> null`

### Recommended configuration
- Column(s)
- Find value
- Replacement value
- Exact match
- Case-sensitive toggle

---

## 3.2 Find & Replace Pattern — NEW

### What it does
Replaces text based on a pattern, typically regex.

### Example

Phone values:

- `017-123-45678`
- `018-987-65432`
- `+8801712345678`

Pattern:

`[^0-9]`

Replacement:

empty

Result:

- `01712345678`
- `01898765432`
- `8801712345678`

### Other uses
- Remove prefixes
- Extract IDs
- Normalize formatting
- Replace text patterns
- Clean structured strings

### Recommended configuration
- Column(s)
- Pattern
- Replacement
- Regex toggle
- Case-sensitive toggle
- Preview of changed values

### Important
This is an advanced operation. Show a preview and warning before applying broad patterns.

---

# 4. TEXT & TYPES

## 4.1 Clean Text — EXISTING

### What it does
Cleans text values by removing common inconsistencies.

### Typical actions
- Trim whitespace
- Lowercase
- Uppercase
- Normalize spaces
- Remove unwanted surrounding whitespace

### Example

`"  Dhaka  "` -> `"Dhaka"`

---

## 4.2 Convert Type — EXISTING

### What it does
Converts a column into another datatype.

### Common types
- Integer
- Float
- String/Text
- Boolean
- Date/Datetime

### Example

`"25"` -> `25`

---

## 4.3 Split Column — NEW

### What it does
Splits one column into multiple columns.

### Example

Before:

| Full Name |
|---|
| John Smith |
| Sarah Ahmed |

Split by `" "`:

| First Name | Last Name |
|---|---|
| John | Smith |
| Sarah | Ahmed |

### Other examples
- Email -> username + domain
- Address -> components
- Product code -> segments

### Recommended configuration
- Source column
- Delimiter
- Number of splits
- Output column names
- Keep original column or remove it

---

## 4.4 Extract Text — NEW

### What it does
Extracts a portion of a text value.

### Supported modes can include
- Prefix
- Suffix
- Substring
- Text before delimiter
- Text after delimiter
- Text between delimiters
- Regex extraction

### Example

`john@gmail.com`

Extract after `@`:

`gmail.com`

### Another example

`ORD-2026-00123`

Extract:

`2026`

or:

`00123`

### Recommended configuration
- Source column
- Extraction method
- Start/end positions when applicable
- Delimiter
- Pattern
- Output column

---

## 4.5 Remove Special Characters — NEW

### What it does
Removes unwanted characters from text.

### Example

Before:

- `J@hn!!`
- `S#rah`
- `017-123-45678`

Possible cleanup:

- `Jhn`
- `Srah`
- `01712345678`

### Recommended configuration
Allow users to select what to keep:
- Letters
- Numbers
- Spaces
- Punctuation
- Custom allowed characters

---

# 5. STRUCTURE

## 5.1 Drop Columns — EXISTING

### What it does
Removes selected columns.

### Example

`Name | Age | Phone | Notes`

Drop `Phone`.

Result:

`Name | Age | Notes`

---

## 5.2 Rename Columns — EXISTING

### What it does
Changes column names.

### Example

`cust_name -> customer_name`

### Recommended configuration
- Old name
- New name
- Multiple rename mappings

---

## 5.3 Merge Columns — NEW

### What it does
Combines two or more columns into one.

### Example

| First Name | Last Name |
|---|---|
| John | Smith |

Merge with `" "`:

| Full Name |
|---|
| John Smith |

### Other examples
- City + Country -> Location
- Year + Month -> Period

### Recommended configuration
- Source columns
- Separator
- Output column
- Keep/remove source columns

---

## 5.4 Reorder Columns — NEW

### What it does
Changes the order of columns without changing their values.

### Example

Before:

`Age | Name | Salary | City`

After:

`Name | Age | City | Salary`

### Recommended UI
A drag-and-drop column list.

---

## 5.5 Create Column — NEW

### What it does
Creates a new derived/calculated column from existing columns.

This should become one of the most important DataFlow operations.

### Example

Columns:

- price
- quantity

Formula:

`total_price = price * quantity`

Result:

| price | quantity | total_price |
|---:|---:|---:|
| 100 | 2 | 200 |
| 250 | 4 | 1000 |

### Other examples
- `age = 2026 - birth_year`
- `profit = revenue - cost`
- `full_name = first_name + " " + last_name`

### Recommended UX
Use a visual formula builder first:

`[price] [×] [quantity]`

Advanced expression mode can be added later.

### Important
Do not require Python for normal users.

---

## 5.6 Conditional Column — NEW

### What it does
Creates a column using IF / ELSE IF / ELSE logic.

### Example

If:

`age < 18 -> Minor`

Else if:

`age < 60 -> Adult`

Else:

`Senior`

Result:

| Age | Group |
|---:|---|
| 17 | Minor |
| 25 | Adult |
| 65 | Senior |

### Recommended UI

IF:
`[Age] [<] [18]`

THEN:
`Minor`

ELSE IF:
`[Age] [<] [60]`

THEN:
`Adult`

ELSE:
`Senior`

### Why it matters
It provides no-code rule-based feature engineering.

---

# 6. CATEGORICAL

## 6.1 One-hot Encode — EXISTING

### What it does
Converts categories into binary indicator columns.

### Example

Before:

| Color |
|---|
| Red |
| Blue |
| Green |

After:

| Color_Red | Color_Blue | Color_Green |
|---:|---:|---:|
| 1 | 0 | 0 |
| 0 | 1 | 0 |
| 0 | 0 | 1 |

### Best use case
Machine-learning preprocessing for categorical features.

---

## 6.2 Label Encode — NEW

### What it does
Converts categories into integer labels.

Example:

- Blue -> 0
- Green -> 1
- Red -> 2

### Important warning
The numbers do not inherently represent ranking.

`Red = 2` does not mean Red is greater than Blue.

### Best use case
Certain machine-learning workflows where numeric category representation is appropriate.

### Recommended configuration
- Column(s)
- Mapping strategy
- Output column name
- Whether to retain original

---

## 6.3 Group Rare Categories — NEW

### What it does
Combines low-frequency categories into `Other`.

### Example

Before:

- Dhaka 40%
- Chittagong 30%
- Sylhet 20%
- Rajshahi 4%
- Khulna 3%
- Barisal 2%
- Rangpur 1%

Threshold:

`5%`

After:

- Dhaka
- Chittagong
- Sylhet
- Other
- Other
- Other
- Other

### Recommended configuration
- Threshold by count or percentage
- Replacement label, e.g. `Other`
- Selected column(s)

### Why it matters
Useful for reducing high-cardinality categories and preventing unnecessarily large feature sets.

---

## 6.4 Standardize Categories — NEW

### What it does
Normalizes different representations of the same category.

### Example

Before:

- Bangladesh
- bangladesh
- BANGLADESH
- `Bangladesh `
- BD

After standardization:

- Bangladesh
- Bangladesh
- Bangladesh
- Bangladesh
- Bangladesh

### Possible actions
- Trim whitespace
- Lowercase
- Uppercase
- Case normalization
- Custom mappings

### Recommended feature
A custom mapping table:

`BD -> Bangladesh`

`BANGLADESH -> Bangladesh`

---

# 7. NUMBERS

## 7.1 Standardize — EXISTING

### What it does
Usually transforms numeric values so the feature has approximately:

- mean = 0
- standard deviation = 1

### Example

A dataset with large numeric scales can become easier for certain ML algorithms to process.

---

## 7.2 Normalize — NEW

### What it does
Typically scales numeric values to a bounded range, commonly `0 to 1`.

### Example

Values:

`20, 40, 60`

Min-max normalization:

- 20 -> 0
- 40 -> 0.5
- 60 -> 1

### Important distinction

Standardize:

- centered around 0
- uses standard deviation

Normalize:

- commonly uses a fixed range such as 0-1

### Recommended configuration
- Column(s)
- Target min
- Target max

---

## 7.3 Round Values — NEW

### What it does
Rounds numeric values.

### Example

`12.34567 -> 12.35`

with 2 decimal places.

### Recommended configuration
- Column(s)
- Decimal places
- Rounding mode

---

## 7.4 Clip Values — NEW

### What it does
Limits numeric values to a specified range.

### Example

Input:

`-5, 25, 40, 150`

Range:

`0 to 100`

Output:

`0, 25, 40, 100`

### Important distinction from Remove Outliers

Remove Outliers:
- Removes the row

Clip:
- Keeps the row
- Changes the extreme value to the boundary

---

## 7.5 Log Transform — NEW

### What it does
Compresses heavily skewed numeric data.

### Example

Values:

`100, 200, 500, 10,000, 100,000`

A log transform reduces the dominance of extremely large values.

### Good use cases
- Income
- Population
- Sales
- Transaction values

### Important warning
Basic logarithms do not accept zero or negative values.

The node should clearly report or handle invalid input.

### Recommended configuration
- Column(s)
- Transform type
- Handling for zero/negative values
- Output column behavior

---

## 7.6 Fourier Transform — NEW

### What it does

Runs a Fast Fourier Transform (FFT) low-pass filter on a numeric column:
the column is treated as a signal, decomposed into its frequency waves,
the high-frequency waves (the jitter/noise) are dropped, and the signal is
rebuilt — smooth version of the same data.

### Example

A noisy sensor reading like:

`4.1, 5.3, 4.0, 6.9, 4.2, 5.1, 4.4, 7.2, ...`

with `keep = 0.25` keeps only the slow trend:

`4.4, 4.7, 5.0, 5.3, 5.5, 5.6, ...`

### Parameters

- **Column** — one fully numeric column (no blanks; run Fill Missing first)
- **Frequencies to keep (0–1)** — lower = smoother (default `0.25`)
- **Decimals** — result rounding (default `4`; keeps the local engine and
  pandas cell-for-cell identical)

### Best use cases

- Sensor/time-series columns with measurement jitter
- Gradual trends hidden by day-to-day noise
- Any numeric column where you want the "signal", not the "noise"

### Important distinction from other numeric ops

Normalize / Standardize rescale values. The Fourier Transform removes
*rapid fluctuation* while keeping the overall shape and the row count.

### Recommended configuration

- Column(s)
- Fraction of frequencies to keep
- Rounding

---

# 8. DATES

## 8.1 Parse Date — NEW

### What it does
Converts text into a real date/datetime datatype.

### Example

Before:

`18/09/2026`

After:

`2026-09-18`

### Supported input styles can include
- DD/MM/YYYY
- MM/DD/YYYY
- YYYY-MM-DD
- Auto Detect

### Recommended configuration
- Source column
- Format
- Timezone if relevant
- Invalid-value handling

---

## 8.2 Extract Date Part — NEW

### What it does
Extracts useful pieces from a date.

### Possible outputs
- Year
- Month
- Day
- Weekday
- Quarter
- Week number
- Hour
- Minute
- Second

### Example

`2026-09-18`

could become:

- Year = 2026
- Month = 9
- Day = 18
- Weekday = Friday
- Quarter = Q3

### Recommended configuration
- Source column
- Date component
- Output column name

---

## 8.3 Date Difference — NEW

### What it does
Calculates the time difference between two dates.

### Example

Start:

`2026-01-01`

End:

`2026-01-10`

Result:

`9 days`

### Supported units
- Days
- Hours
- Minutes
- Seconds
- Months
- Years

### Use cases
- Order -> delivery duration
- Start -> end duration
- Birth date -> reference date
- Subscription duration

### Recommended configuration
- Start date column
- End date column
- Output unit
- Output column name

---

# 9. DATA QUALITY

Data Quality operations are different from transformation operations.

### Transformation nodes
Modify the dataset.

### Quality nodes
Inspect, validate, or report issues.

This distinction is useful for the pipeline engine.

Example:

Dataset
-> Find Invalid Values
-> Replace Values
-> Validate Column
-> Output

---

## 9.1 Validate Column — NEW

### What it does
Checks whether a column satisfies specified rules.

### Example

Column:

`Age`

Rules:

- Expected type = Integer
- Minimum = 0
- Maximum = 120

Result:

- 12,430 valid
- 24 invalid

### Possible validation rules
- Expected datatype
- Required / not null
- Minimum
- Maximum
- String length
- Pattern/regex
- Allowed values
- Unique
- Email
- URL
- Date
- Numeric range

### Recommended UX

Show a validation result:

`✓ 12,430 valid`

`⚠ 24 invalid`

Then:

`[Show affected rows]`

---

## 9.2 Find Invalid Values — NEW

### What it does
Finds values that appear to violate expected rules or datatype assumptions.

### Example

Age column:

`10, 25, 31, -5, 250, abc`

The node identifies:

- `-5` -> below valid range
- `250` -> above valid range
- `abc` -> invalid numeric value

### Result

Possible report:

| Invalid Value | Count | Reason |
|---|---:|---|
| -5 | 1 | Below minimum |
| 250 | 2 | Above maximum |
| abc | 4 | Not numeric |

### Important distinction

Validate Column asks:

> Does this column satisfy my defined rules?

Find Invalid Values asks:

> Which values look wrong, and why?

---

# 10. RECOMMENDED COMPLETE OPERATION LIBRARY

## MISSING DATA

- Fill Missing — EXISTING
- Drop Missing Rows — EXISTING
- Forward Fill
- Backward Fill
- Remove Empty Rows
- Remove Empty Columns

## ROWS

- Drop Duplicates — EXISTING
- Filter Rows — EXISTING
- Sort Rows — EXISTING
- Remove Outliers — EXISTING

## VALUES

- Replace Values
- Find & Replace Pattern

## TEXT & TYPES

- Clean Text — EXISTING
- Convert Type — EXISTING
- Split Column
- Extract Text
- Remove Special Characters

## STRUCTURE

- Drop Columns — EXISTING
- Rename Columns — EXISTING
- Merge Columns
- Reorder Columns
- Create Column
- Conditional Column

## CATEGORICAL

- One-hot Encode — EXISTING
- Label Encode
- Group Rare Categories
- Standardize Categories

## NUMBERS

- Standardize — EXISTING
- Normalize
- Round Values
- Clip Values
- Log Transform

## DATES

- Parse Date
- Extract Date Part
- Date Difference

## DATA QUALITY

- Validate Column
- Find Invalid Values

---

# 11. IMPLEMENTATION PRIORITY

Do not necessarily implement all operations at once.

## Tier 1 — Essential

1. Forward Fill
2. Backward Fill
3. Replace Values
4. Split Column
5. Merge Columns
6. Create Column
7. Conditional Column
8. Normalize
9. Round Values
10. Parse Date
11. Extract Date Part

These add major real-world capability.

## Tier 2 — Very Useful

12. Remove Empty Rows
13. Remove Empty Columns
14. Reorder Columns
15. Extract Text
16. Clip Values
17. Label Encode
18. Group Rare Categories
19. Date Difference

## Tier 3 — Advanced

20. Find & Replace Pattern
21. Remove Special Characters
22. Standardize Categories
23. Log Transform
24. Validate Column
25. Find Invalid Values

---

# 12. IMPORTANT PRODUCT DESIGN PRINCIPLE

Do not make every operation a completely unique implementation.

Build a reusable node architecture.

Each operation should define:

- Name
- Category
- Description
- Input type requirements
- Configuration schema
- Validation rules
- Execution function
- Preview behavior
- Code generation
- Large-data compatibility
- Error messages

For example:

Create Column:

- Input: tabular dataset
- Config: formula, output column
- Validation: referenced columns must exist
- Execute: controlled expression engine
- Preview: before/after preview
- Codegen: pandas expression
- Security: never execute arbitrary Python

This will make future operation additions much easier.

---

# 13. IMPORTANT DISTINCTION FOR DATA QUALITY

Consider treating quality/inspection nodes separately from transformation nodes.

### Transform nodes

Change data:

- Fill Missing
- Replace Values
- Split Column
- Create Column
- Normalize
- Parse Date

### Quality nodes

Inspect/report:

- Validate Column
- Find Invalid Values
- Profile
- Find Duplicates
- Find Missing Values

This distinction will help keep the DataFlow execution engine clean as the product grows.

---

# 14. CORE OPERATIONS TO PRIORITIZE FOR DATFLOW

The strongest additions for DataFlow are:

1. Create Column
2. Conditional Column
3. Replace Values
4. Split Column
5. Merge Columns
6. Parse Date
7. Extract Date Part
8. Forward Fill
9. Backward Fill
10. Normalize

These provide a large amount of practical preprocessing power without creating an unnecessarily huge operation list.

`Create Column` and `Conditional Column` are especially important because they allow DataFlow to support broader feature engineering without creating a separate operation for every small mathematical or rule-based transformation.

---

# 15. EXAMPLE COMPLETE PIPELINE

A realistic DataFlow pipeline could look like:

Dataset
  ↓
Remove Empty Rows
  ↓
Clean Text
  ↓
Replace Values
  ↓
Forward Fill
  ↓
Drop Duplicates
  ↓
Filter Rows
  ↓
Split Column
  ↓
Create Column
  ↓
Conditional Column
  ↓
Parse Date
  ↓
Extract Date Part
  ↓
Normalize
  ↓
One-hot Encode
  ↓
Validate Column
  ↓
Clean Output

The resulting platform is no longer just a CSV cleaner. It becomes a visual data preparation/preprocessing environment.

---

# 16. FINAL RECOMMENDED SIDEBAR

MISSING DATA
- Fill Missing
- Drop Missing Rows
- Forward Fill
- Backward Fill
- Remove Empty Rows
- Remove Empty Columns

ROWS
- Drop Duplicates
- Filter Rows
- Sort Rows
- Remove Outliers

VALUES
- Replace Values
- Find & Replace Pattern

TEXT & TYPES
- Clean Text
- Convert Type
- Split Column
- Extract Text
- Remove Special Characters

STRUCTURE
- Drop Columns
- Rename Columns
- Merge Columns
- Reorder Columns
- Create Column
- Conditional Column

CATEGORICAL
- One-hot Encode
- Label Encode
- Group Rare Categories
- Standardize Categories

NUMBERS
- Standardize
- Normalize
- Round Values
- Clip Values
- Log Transform

DATES
- Parse Date
- Extract Date Part
- Date Difference

DATA QUALITY
- Validate Column
- Find Invalid Values
