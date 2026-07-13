# Platform subscription operations

Phase 4 adds product entitlements without embedding a payment processor or speculating on a billing vendor. The external contract/billing system remains the commercial source of truth; Sartre's reviewed `client.yaml` mirrors the operational fields the runtime needs:

- `plan`: `engagement` during delivery or `platform` post-engagement;
- `status`: `trialing`, `active`, `past_due`, or `canceled`;
- `licensed_modules`: an explicit allowlist, with an empty list meaning all manifest-enabled modules;
- `portal_seats` and `renewal_date` for provisioning and renewal operations.

New scheduled runs are blocked when status is `past_due`/`canceled` or the module is unlicensed. The runner repeats the commercial check before resuming a parked run, so a previously approved effect cannot execute after service becomes inactive. The portal also blocks new approvals and copilot requests while inactive. Historical dashboards remain the auditable engagement record.

At engagement conversion, the commercial owner updates the manifest in a reviewed commit, provisions identity grants up to the contracted seat count, verifies the licensed always-on modules, and records the external subscription identifier only in the billing system—not in this repository.
