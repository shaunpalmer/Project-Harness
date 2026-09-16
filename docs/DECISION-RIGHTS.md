# Decision Rights Contract

The agent must not transfer ordinary programming work back to the user. It should ask only when the answer materially changes purpose, architecture, cost, security, scope, data handling, or release authority.

| Decision | Owner | Required behaviour |
|---|---|---|
| Routine implementation | the agent | Decide, implement, and test |
| Reversible technical choice | the agent | Choose the best fit, run a bounded proof when uncertain, and proceed |
| Established engineering default | the agent | Apply `ENGINEERING-DEFAULTS.md` and the relevant ecosystem skill automatically |
| Language/runtime chosen directly by a confirmed default for a new project | the agent | Apply the default and record the evidence; do not ask the user to select the obvious ecosystem language |
| Material departure from an established/default language, framework, database, or architecture | the user | Present one recommendation with evidence and request approval |
| Provider or model strategy | the user | Request approval when cost, privacy, capability, or lock-in changes |
| Financial commitment | the user | State expected cost and request approval before consumption |
| Security boundary or sensitive-data exposure | the user | Explain the changed risk and request approval |
| Destructive or difficult-to-recover action | the user | Identify the exact target and request explicit approval |
| Local Git init/status/feature branch/focused checkpoint | the agent | Perform automatically as part of normal execution |
| Attach an explicitly identified existing Git remote and verify existing machine authentication | the agent | Use existing Git/SSH/GitHub CLI credentials; never request or persist tokens |
| Push an already-authorised non-default work/feature branch | the agent | Push after verification; never force push |
| Create/delete a remote repository, change default-branch policy, rewrite published history, force push | the user | Recommend and request explicit approval |
| Merge, deployment, production mutation, or release | the user | Verify readiness, then request explicit approval |
| Safe checkpoint, focused commit, tests, and documentation reconciliation | the agent | Perform automatically within the approved work |

## Default-versus-deviation principle

A mature ecosystem can answer many architecture-adjacent questions without becoming a consequential fork. For example, a confirmed WordPress plugin defaults to PHP and The WordPress Way; a new scraping/ingestion pipeline defaults to Python unless repository/runtime evidence says otherwise.

Applying that established default is routine. Changing an existing project's established stack, introducing a materially different runtime, or overriding a default for architectural reasons is consequential and belongs to the user.

## Version-control principle

Version control is part of the execution contract, not a special feature to negotiate during every project.

the agent may automatically:

- verify Git availability and repository state;
- initialise a new local repository for a newly-created project;
- create/switch to a safe non-default work branch;
- inspect status/history;
- stage only explicitly intended files;
- create focused commits after proof passes;
- verify an explicitly supplied GitHub remote using existing machine credentials;
- push an already-authorised non-default work branch.

the agent must not automatically:

- expose/store credentials or tokens;
- broadly stage unrelated work;
- force push or rewrite published history;
- push directly to `main`/`master`;
- create/delete a GitHub repository without approval;
- merge a pull request;
- publish/release/deploy.

## Competency principle

When the design envelope is sufficient, the agent makes internal choices such as `if` versus `switch`, naming, loop form, helper boundaries, error handling, test organisation, and whether a small responsibility is best expressed as a function or method. Uncertainty is resolved by inspecting evidence or running a small test—not by asking the user to program through the agent.

## Question budget

Routine engineering question budget is **zero**. The target is no more than a small number of genuinely consequential questions for an entire project. A long list of implementation questions is evidence that the harness has failed to apply its defaults or inspect available evidence.

## Decision card

When approval is required, ask once using this compact shape:

```text
Decision: [consequential fork]
Recommendation: [one preferred option]
Why: [evidence tied to the North Star]
Cost/risk: [material trade-off]
Alternatives: [only credible alternatives]
Approval required: [exact action]
```
