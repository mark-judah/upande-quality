// Conventional Commits config for the PR-title lint (see
// .github/workflows/semantic-commits.yml). semantic-release (angular preset)
// reads these types on main to compute the next version:
//   feat  -> minor,  fix/perf -> patch,  BREAKING CHANGE -> major.
module.exports = { extends: ['@commitlint/config-conventional'] };
