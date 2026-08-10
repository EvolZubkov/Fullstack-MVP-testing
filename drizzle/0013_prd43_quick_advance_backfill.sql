-- Custom SQL migration file, put your code below! --
UPDATE "tests" SET "quick_advance" = NOT "allow_return_to_unanswered";
