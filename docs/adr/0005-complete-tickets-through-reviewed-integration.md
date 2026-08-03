# Complete tickets through reviewed integration

Only leaf work runs. Each ticket uses `/implement` with Code Review as its completion gate, then integrates serially into a dedicated Workstream Baseline created from a user-confirmed Fixed Point. A ticket releases dependents only after reviewed integration, tracker closure, and synchronization all succeed. Cancellation does not satisfy required work, tracker blockers have no local waiver, and baseline refresh is always explicit.
