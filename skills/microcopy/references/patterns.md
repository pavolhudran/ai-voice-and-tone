# Microcopy patterns

Budgets are defaults. A channel playbook in `<KB>/channels/` overrides them, and
a platform constraint - a push notification cap, a column width - overrides both.

| Element | Budget | Shape | Usual cell |
|---|---|---|---|
| Button / primary action | 1-3 words, 20 characters | verb first, says what happens | `product-ui` + `focused` |
| Button / secondary | 1-3 words, 20 characters | never "Cancel" when a real verb exists | `product-ui` + `focused` |
| Link label | 2-6 words | names its destination, reads alone | any |
| Error message | 1-2 sentences, 140 characters | what happened, then what to do | `system-error` + `frustrated` |
| Form validation | 1 sentence, 80 characters | what is wrong with *this field* | `product-ui` + `confused` |
| Empty state | 1-3 sentences plus an action | why it is empty, what fills it | `product-ui` + `uncertain` |
| Notification / toast | 1 sentence, 90 characters | the outcome, not the process | `notification` + varies |
| Push notification | title 40 characters, body 120 | front-load; the tail gets truncated | `notification` + varies |
| Tooltip | 1 sentence, 80 characters | the thing the label could not say | `product-ui` + `uncertain` |
| Placeholder | 1-4 words | an example, never a duplicate of the label | `product-ui` + `focused` |
| Confirmation dialog | title plus 1-2 sentences plus 2 buttons | name the consequence in the title | `product-ui` + `anxious-at-risk` |
| Loading state | 2-5 words | what is happening, not "Please wait" | `product-ui` + `focused` |
| Success message | 1 sentence, 90 characters | confirm the outcome, offer the next step | `product-ui` + `delighted` |

## Error messages

The shape that works, in order:

1. **What happened** - concretely, in the reader's terms
2. **Why**, if the reason is actionable. Skip it if it is not.
3. **What to do next** - one action, not a list

> "That file didn't upload - it's over the 25 MB limit. Try a smaller one."

What that avoids: no error code as the first thing, no "oops", no "something went
wrong" without saying what, no blame, no joke, no second apology.

## Confirmation dialogs

The title carries the consequence, not the question. "Delete 4 campaigns?" beats
"Are you sure?", because a reader who skims only the title still knows what is
about to happen. Buttons name their actions - "Delete" and "Keep", never "OK" and
"Cancel".

## Empty states

An empty state is the only screen guaranteed to be seen by every new user. Say why
it is empty, say what will fill it, and give exactly one way to start. `anxious`
is the wrong read here - a new user is `uncertain`, and reassurance without an
action is just noise.
