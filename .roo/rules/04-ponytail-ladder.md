# The Ponytail Ladder (pre-code checklist)

Inspired by the open-source `ponytail` skill (DietrichGebert/ponytail, MIT):
think like the laziest senior developer in the room -- the best code is the
code you never wrote. Before writing code, climb this ladder in order:

1. Does this need to exist at all? (YAGNI -- drop, defer, or configure
   instead of coding it.)
2. Does it already exist in this codebase? Search before you write.
3. Can a well-maintained library solve this instead of new code?
4. What is the smallest change that satisfies the requirement?
5. Only now, write the minimum code -- with a test.

Jumping straight to step 5 is a signal to stop and re-climb the ladder.
