# Final submission documents

The documents describe the Hospital Management System at [commit b51c009](https://github.com/PES1UG24AM921/13/commit/b51c009f80c2fdc0aa1253be2ce58f14e94d4fae). The final test reports are dated 17 November 2026.

| Deliverable | File |
| --- | --- |
| Software requirements | [SRS v1.2](SRS/SRS_SE.docx) |
| Architecture and design | [SAD v2.0 PDF](SAD/SAD_SE.pdf), [editable SAD](SAD/SAD_SE.docx) |
| Test plan | [STP v1.2](TestPlan/STP_SE.docx) |
| Requirements traceability | [RTM workbook](RTM/RTM_HMS.xlsx) |
| Test cases | [Execution workbook](RTM/Test_Cases_HMS.xlsx) |
| Unit test report | [Jest and Supertest results](Testing_Reports/Unit_Test_Report.pdf) |
| System validation report | [Validation results and outstanding cases](Testing_Reports/System_Validation_Report.pdf) |
| Code coverage report | [Backend statement, line and function coverage](Testing_Reports/Code_Coverage_Report.pdf) |
| Branch coverage report | [Backend branch coverage](Testing_Reports/Branch_Coverage_Report.pdf) |
| Deviations | [Change log](Software_Deviations_and_Change_Log.docx) |
| Presentation | [Demo and viva slides](Presentation/Hospital_Management_System_Final_Presentation.pptx) |
| Agile evidence | [Project board](https://github.com/users/PES1UG24AM921/projects/1), [repository history](https://github.com/PES1UG24AM921/13/commits/b51c009f80c2fdc0aa1253be2ce58f14e94d4fae/) |

The final reports record 105 passing automated checks and two skipped tests. The test case workbook records 85 passes, zero failures and 18 not run out of 103 scenarios. These are separate counts. Automated tests used a mocked database. Browser workflows, real MySQL validation and performance still require a live run. Statement coverage was 76.71% and branch coverage was 67.72%.

The original [security](TestPlan/Security_Test_Report.xlsx) and [non-functional](TestPlan/NonFunctional_Test_Report.xlsx) worksheets remain available as earlier execution records. Use the final test case workbook and validation report for the latest recorded status. The supplied report package did not include the separately referenced raw Jest and coverage files or the two sprint videos.

To rerun the backend checks from the repository root:

```powershell
cd backend
npm ci
npm run lint
npm test -- --coverage --coverageReporters=text --coverageReporters=json-summary --coverageReporters=lcov
```

See [local setup](../SETUP_LOCAL.md) for runtime configuration. The opt-in MySQL cases use `HMS_RUN_DB_INTEGRATION=true` with an isolated `hms_test` schema.
