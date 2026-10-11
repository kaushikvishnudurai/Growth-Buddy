# Food and Water: inputs to log, before and after

How the counts work: taps (scrolls listed apart) and fields typed, counted from the Food screen
unless the row says Home. Before = overhaul/2026-10-11 at build 95. After = ov1011/food. Measured at
390x844 and 360x740 on an account with 9 foods logged and 3 starred (`e2e/food-fixes.spec.mjs` seeds it).

| Flow | Before | After |
|---|---|---|
| (a) A food eaten before (chip) | 3 taps (Log food, chip fills the form, Add food), 0 fields | **2 taps** (Log food, chip logs it), 0 fields, no wait |
| (a') A food eaten before, typed by name | 2 taps, 1 field, then an ~11 s AI estimate with the dialog held open (only the grams were remembered) | 2 taps, 1 field: the last portion (grams or pieces) and its kcal fill in, so it saves at once with no estimate |
| (b) A new food, name only | 2 taps, 1 field, then the dialog held ~11 s behind "Estimating calories" | 2 taps, 1 field: the dialog closes on the tap and the estimate runs behind it |
| (b') A new food with typed kcal | 3 taps + 1 scroll (Calories sat at y=967 on an 844 px screen, under 8 wrapped chips), 2 fields | 3 taps, 0 scrolls (Calories at y=335), 2 fields |
| Water from Home | 3 taps (More, Food, +250 ml) | **1 tap** (the "+ 250 ml · N% water" pill), Undo on the toast |
| See or delete an earlier glass (5 today) | not possible: only the newest 3 were listed | 1 tap (Show all 5), then its delete |

Where the Food field sits when Log food opens (top of the field / bottom of the viewport):
before 349 / 844 at 390x844 (visible, but the chips under it pushed Amount and Calories off screen);
after 101 / 844, with Amount, Calories and Add food all on screen. With a 320 px keyboard at 360x740
the Food field, the focused Amount field and Add food stay above it (`after-keyboard-360.jpg`).

Not done here: FRC's 1-tap "Again?" chip per meal slot on Home (Home's ordering belongs to the
onboarding agent). From Home, a food eaten before is still More, Food, Log food, chip: 5 taps down to 4.
