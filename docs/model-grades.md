# Model grade sheet

Every agent run on real work, graded by the reviewer (correctness 35,
faithfulness to the spec 20, process 20, code fit 15, report 10; a false
claim in the report fails the run). Update after each review. "Claude fix"
is how much the reviewer had to change before merging.

Grades: A, A-, B+, B, B-, C+, C, C-, D, F. Use "F (infra)" when the
provider failed (rate limit, endpoint down) and the model never got to
work, and "n/a" when a limit cut the run off before anything gradable; both
are left out of the GPA (`tools/grades_to_json.py`).

## By model

| model | tier | runs | merged | grades | verdict |
|---|---|---|---|---|---|

## Runs

| date | task | model | cost | time | grade | merged | Claude fix | notes |
|---|---|---|---|---|---|---|---|---|
