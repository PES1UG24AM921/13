# Demo and viva notes

| Topic | What to explain |
| --- | --- |
| Functional requirement | The system checks that a doctor has an available slot before confirming a booking. It rejects a conflicting booking and returns an error. |
| Non-functional requirement | The target is at least 95% of API requests within two seconds at 50 concurrent users. The load check is still pending. The browser compatibility requirement includes a 360 px viewport. |
| Architecture | React is the presentation tier. Express routes, middleware, controllers and models make up the application tier. MySQL is the data tier. The UI calls the API over HTTP locally. Booking uses a transaction and database constraints. |
| Burn-up | The board assigns 30 points to Sprint 1 and 38 to Sprint 2. Based on final issue closures, 14 points were complete by 23 October, 56 by 30 October and all 68 by 6 November. The scope line is the final backlog total. |
| Commits | Main history shows 3 commits in Sprint 1 and 13 in Sprint 2, including merges. The chart uses committer timestamps in IST. Use board items and PRs to explain individual work. |
| Testing | The final report records 105 passing, zero failing and two skipped automated tests. The database was mocked, and 18 cases in the 103-case workbook still need verification. |

## Demonstration order

1. Sign in as an admin, create or select a seeded doctor, find the account using a filter, and open the audit log.
2. As a doctor, add a recurring slot on a future date. As a patient, find the doctor, choose that date and book the slot. Show the booking under both accounts.
3. Show cancellation and slot availability. Demonstrate rescheduling and editing medical records through the API if asked. Explain documented deviations before switching from the UI.
4. Show the board, burn-up, commit chart, test case workbook, RTM and CI. Point to [functional tests #7](https://github.com/PES1UG24AM921/13/issues/7), [security checks #9](https://github.com/PES1UG24AM921/13/issues/9), [RTM #13](https://github.com/PES1UG24AM921/13/issues/13) and [non-functional checks #16](https://github.com/PES1UG24AM921/13/issues/16) for Rohan's work.

Use synthetic records for the demo. Record the one-minute and two-minute sprint videos from the corresponding sprint outcomes if the originals are unavailable. Label any later recording with the version shown.
