# User model integration

Source: https://github.com/Ferrsir/options-pricer

Pinned source commit: `68c363608c3722a60e08470c78c7db8dd4c28b3f`.

Imported file: `docs/js/pricing.js`, Git blob `382631abc0b152bc0eebb0038b1c6dc11ce06aaa`.

Local original: `shared/vendor/pricing.js`. It is kept unchanged. It mirrors the upstream Python implementation in `src/pricer/bsm.py` and includes BSM prices/Greeks, IV inversion, American CRR pricing, convergence routines, and LSMC.

Pulse calls this existing JavaScript instead of reimplementing BSM or requiring Python scientific packages. `shared/vendor/pricing.d.ts` adds declarations only. `shared/pricing.ts` handles input validation and display units: volatility/rates/dividends are decimals internally, expiry is ACT/365, theta is per calendar day, vega is per IV percentage point, rho is per interest-rate percentage point, and premiums are per share. Contract premium uses the contract multiplier; the default is 100.

The lab compares European BSM with a 300-step American CRR estimate. At expiry or zero IV, BSM returns its limit value; undefined Greeks are shown as unavailable. Some low-IV/high-carry inputs violate the CRR tree's no-arbitrage condition, in which case the American comparison is unavailable. No claim is made that the model is an executable market price. Rates and dividend yields are entered assumptions, not an automatically calibrated yield curve or dividend schedule.

Tests use an independent reference value, put-call parity, finite-difference delta, IV inversion, expiry limits, and American put inequalities. Future upstream updates should be pinned to a new commit and documented here.
