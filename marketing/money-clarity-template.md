# money rundown · money-clarity template

the money-admin your nervous system won't let you open. handled.

---

## how to use this

money avoidance is a freeze state. not a discipline problem.

when the numbers feel like too much, your body doesn't get lazy. it goes quiet. it veils the whole thing so you don't have to feel it. that quiet is protection. it is also why invoices sit unopened and money you're owed goes unread.

this template does one thing. it holds your money in a shape you can look at once a week without opening the freeze.

you copy it into your own workspace. you fill it in once. after that you touch it for ten minutes a week. that's the whole ritual.

the structure is small on purpose. two things to look at. one weekly page to read. nothing else.

nothing here accuses you. nothing here rushes you. it flags what is worth a look. it never tells you what's wrong with you.

**setup, once:**
1. duplicate this page into your own notion.
2. build the one database below (the ledger).
3. add the six views.
4. copy the weekly ritual page.
5. pick a day. sunday works. that's your read.

that's it. the freeze doesn't need more steps. it needs fewer.

---

## the structure: one ledger

**pick: a single ledger database. not two.**

one line, justified: two databases means two places to look, and a freeze state stops at two. one ledger holds every money event in one table, and the views split it for you. you never sort anything by hand.

every row is one money event. an invoice you sent. a payment that arrived. a vendor charge that left. one row each.

### database: `ledger`

build these properties in this order.

| property | type | options / notes |
|---|---|---|
| `who` | title | client or vendor name. the name of the person or company. |
| `direction` | select | `sent` (you invoiced them) · `received` (money arrived) · `paid out` (a charge left you) |
| `amount` | number | format as dollar. always positive. `direction` carries the sign. |
| `currency` | select | `USD` · `CAD` · `EUR` · `GBP`. default USD. |
| `date sent` | date | the day you sent the invoice. blank for arrivals with no invoice. |
| `date paid` | date | the day money moved. blank while outstanding. |
| `due date` | date | when the invoice is due. blank for arrivals and charges. |
| `status` | select | `paid` · `outstanding` · `overdue` · `flagged` |
| `days out` | formula | see below. |
| `worth a look` | checkbox | ticked when the numbers didn't match cleanly. |
| `reason` | text | plain-language note. only filled when `worth a look` is ticked. |
| `notes` | text | anything you want. optional. |

**`days out` formula** (paste into the formula field):

```
if(prop("status") == "paid", 0,
  if(empty(prop("date sent")), 0,
    dateBetween(now(), prop("date sent"), "days")))
```

this counts days since you sent the invoice. paid rows read 0.

**the status rule, so you never guess:**
- money arrived → `direction` = received, `status` = paid.
- invoice sent, not paid, `days out` 0 to 44 → `status` = outstanding.
- invoice sent, not paid, `days out` 45 or more → `status` = overdue.
- numbers didn't match → tick `worth a look`, set `status` = flagged, write the `reason`.

45 days is the line where outstanding becomes overdue. under 30 is neutral. nothing is late until it crosses.

---

## the views

six views on the one ledger. build each as a new view of `ledger`. non-technical steps below.

### 1. `this week`
- **view type:** table.
- **filter:** `date paid` is within the past 1 week, OR `date sent` is within the past 1 week.
- **sort:** `date paid`, newest first.
- what moved this week. arrivals and new invoices. nothing else.

### 2. `what arrived`
- **view type:** table.
- **filter:** `direction` is `received`.
- **sort:** `date paid`, newest first.
- **show:** who · amount · date paid.
- money that landed. the paid list.

### 3. `what you're owed`
- **view type:** table.
- **filter:** `status` is `outstanding`.
- **sort:** `days out`, largest first.
- **show:** who · amount · date sent · days out.
- open invoices under the overdue line. factual. no action implied.

### 4. `overdue`
- **view type:** table.
- **filter:** `status` is `overdue`.
- **sort:** `days out`, largest first.
- **show:** who · amount · days out.
- past the due date. plain. no red, no alarm. leave the styling calm.

### 5. `worth a look`
- **view type:** table.
- **filter:** `worth a look` is checked.
- **sort:** `date paid`, newest first.
- **show:** who · amount · reason.
- the rows where the numbers didn't match cleanly. that's all it means.

### 6. `everything`
- **view type:** table.
- **filter:** none.
- **sort:** `date paid`, newest first.
- the full ledger. the place you add new rows.

optional seventh: `board by status`, a board view grouped by `status`. same data, four columns. use it only if columns settle you more than lists.

---

## the weekly ritual page

copy this whole page into notion. read it top to bottom once a week. fill the blanks from your views. the copy is already written. you only drop in numbers.

ten minutes. one day a week. that's the ritual.

---

> ### money rundown · week of [DATE]
>
> [first name], here's where your money is.
>
> ---
>
> **what arrived**
>
> [name · $amount · received DATE]
> [name · $amount · received DATE]
>
> *empty:* nothing arrived this week.
>
> ---
>
> **what you're owed**
>
> [client · $amount · sent DATE · X days out]
> [client · $amount · sent DATE · X days out]
>
> you have $[X] outstanding across [N] invoices.
>
> *empty:* nothing outstanding this week.
>
> ---
>
> **overdue**
>
> [client · $amount · X days past due date]
> [client · $amount · X days past due date]
>
> *empty:* nothing overdue this week.
>
> ---
>
> **worth a look**
>
> [client · $amount · plain reason]
>
> this doesn't mean something's wrong. it means the numbers didn't match cleanly.
>
> *empty:* nothing flagged this week.
>
> ---
>
> **this week**
>
> paid: $[X]
> outstanding: $[X] ([N])
> overdue: $[X] ([N])
> flagged: [N]
>
> ---
>
> money rundown reads your Gmail · read-only, always
> your data doesn't train anything · deletes on cancel
>
> adjust settings · change tier · pause digest · cancel
>
> ---
>
> **[year] so far** *(optional, year-end)*
>
> invoiced: $[X]
> received: $[X]
> outstanding: $[X]
> average time to payment: [X] days
>
> [year] looked like this. that's yours.

---

### what goes in `worth a look`

tick the box and write the reason when one of these is true:
- a payment came in for a different amount than the invoice.
- the same charge shows up twice.
- a payment arrived with no invoice to match it.
- a vendor charged you with no invoice before it.

write the reason plain. one line. examples:
- payment came in $50 under the invoice.
- this charge appears twice on the same day.
- money arrived with no invoice attached.
- vendor charge with nothing before it.

that's the whole trigger list. if none are true, the box stays empty.

---

## variant states

when the week isn't a normal week, the header block changes. swap in the matching line. no shame lives in any of these.

**new account**
> money rundown is reading. your first real digest arrives next week.

**all clear**
> nothing owed, nothing overdue, nothing flagged. that's the whole picture.

**high outstanding**
> you have $[X] outstanding across [N] invoices. that's the number. it sits here until it moves.

**long quiet**
> no new invoice activity this week. this is just the current state.

present the number. don't dress it. the state is the state.

---

## the shape of the ritual, one more time

one ledger. six views. one page you read on your day.

you don't chase. you don't score yourself. you look once, you close it, you go back to the work.

the money stays in a shape you can face. that's the whole point.
