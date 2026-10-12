# Pull request workflow

The user wants pull requests created automatically for changes in this repository.

- Implement changes on a dedicated feature branch, not directly on `main`.
- After completing relevant checks, commit the task's changes, push the branch,
  and open a pull request against `main` without asking again. Update an existing
  open PR when continuing the same task rather than creating a duplicate.
- Include a concise summary, checks performed, and any deployment requirements
  (including Firestore rules) in the PR. Give the user its URL.
- Leave PRs open for review. Do not merge or deploy unless the user authorizes it.
- Preserve unrelated user changes. If changes are already on `main`, report that
  there is no remaining diff; do not revert or duplicate them just to create a PR.
