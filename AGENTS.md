# Lobby implementation

The Founder-approved Rdy baseline is `v0.2.0`. Work from the linked live Rdy project for later approvals. This repository is linked as `lobby`.

## Design to code

1. Open an Rdy session. Brief the decisions, requirements, and neighboring blocks before editing.
2. Check the proposed behavior against accepted decisions. For a changed decision, use its trace and impact to identify code, migrations, and tests that need work.
3. Add an `Implements: <Rdy block or decision IDs>` trailer to the relevant Git commit. Put those IDs and verification results in the pull request. If the merge squashes commits, carry the trailer into the squash commit.

## Code to design

1. If code, testing, or staging exposes a gap, record a finding in Rdy. Link a commit or reproducible test result as evidence. Cite the affected blocks and say whether the finding clarifies the design or changes it.
2. Update the affected Rdy blocks in a named view. Use `reflects` and a code path for facts verified against the implementation. Recheck suspects after committed files change. Repin only after checking the docs against the code.
3. Send any change to an accepted decision, public contract, durable data or security posture through the Founder review path. Keep implementation work on the affected behavior tied to that proposal.
4. Keep actual implementation and staging evidence separate from planned behavior. Leave approval and launch to Founder.

## MVP pace and tests

1. Build the smallest useful end-to-end slice. Choose a reversible default when the approved design leaves room. Record it and keep moving. Escalate changes to approved decisions, public contracts, durable data, or security.
2. Test the main success path and the failures that could expose data, lose or overwrite work, duplicate a write, or block recovery. Add a regression test for a meaningful bug. Skip exhaustive permutations and duplicate tests. Keep the agreed staging and pilot checks.

The first product slice is the PostgreSQL schema and the wire contracts for verification, Save, Publish and Unpublish. The staging bootstrap covers HTTP process liveness.
