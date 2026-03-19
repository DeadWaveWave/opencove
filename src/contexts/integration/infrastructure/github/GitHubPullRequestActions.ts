import type {
  ExecuteGitHubPullRequestActionInput,
  ExecuteGitHubPullRequestActionResult,
} from '../../../../shared/contracts/dto'
import { normalizeText } from './githubIntegration.shared'
import {
  buildGhEnv,
  formatCommandError,
  isGhAuthenticated,
  isGhAvailable,
  parsePrUrlFromOutput,
  resolveDefaultRemote,
  runCommand,
  runGhWithBodyFile,
  runGit,
  selectorToGhArg,
} from './GitHubGh'
import { parsePullRequestDetails } from './GitHubPullRequestParse'
import { executeStubAction, shouldUseTestStub } from './GitHubPullRequestTestStub'

async function publishBranch(
  repoPath: string,
  branch: string,
  remote: string | null,
): Promise<void> {
  const resolvedBranch = branch.trim()
  if (resolvedBranch.length === 0) {
    throw new Error('publishBranch requires branch')
  }

  const resolvedRemote = remote?.trim() || (await resolveDefaultRemote(repoPath))
  if (!resolvedRemote) {
    throw new Error('No git remote configured for this repository')
  }

  const result = await runGit(repoPath, ['push', '-u', resolvedRemote, resolvedBranch])
  if (result.exitCode !== 0) {
    throw new Error(normalizeText(result.stderr) || 'git push failed')
  }
}

async function loadPullRequestByUrl(repoPath: string, url: string): Promise<unknown> {
  const result = await runCommand(
    'gh',
    [
      'pr',
      'view',
      url,
      '--json',
      'number,title,url,state,isDraft,author,updatedAt,baseRefName,headRefName,body,mergeable,reviewDecision',
    ],
    repoPath,
    { env: buildGhEnv(), timeoutMs: 30_000 },
  )

  if (result.exitCode !== 0) {
    throw new Error(formatCommandError(result, 'Pull request created, but could not be loaded'))
  }

  try {
    return JSON.parse(result.stdout) as unknown
  } catch {
    throw new Error('Pull request created, but could not be parsed')
  }
}

export async function executeGitHubPullRequestAction(
  input: ExecuteGitHubPullRequestActionInput,
): Promise<ExecuteGitHubPullRequestActionResult> {
  if (shouldUseTestStub()) {
    return executeStubAction(input)
  }

  const ghAvailable = await isGhAvailable(input.repoPath)
  if (!ghAvailable) {
    throw new Error('GitHub CLI (gh) was not found on PATH.')
  }

  const authed = await isGhAuthenticated(input.repoPath)
  if (!authed) {
    throw new Error('GitHub CLI (gh) is not authenticated. Run `gh auth login`.')
  }

  const action = input.action

  if (action.kind === 'publish_branch') {
    const branch = action.branch.trim()
    if (branch.length === 0) {
      throw new Error('publish_branch requires branch')
    }

    await publishBranch(input.repoPath, branch, action.remote)

    return { kind: 'completed' }
  }

  if (action.kind === 'create') {
    const branch = action.branch.trim()
    const title = action.title.trim()
    if (branch.length === 0 || title.length === 0) {
      throw new Error('create requires branch and title')
    }

    await publishBranch(input.repoPath, branch, null)

    const args = ['pr', 'create', '--head', branch, '--title', title]
    if (action.base?.trim()) {
      args.push('--base', action.base.trim())
    }
    if (action.draft) {
      args.push('--draft')
    }

    const result = await runGhWithBodyFile(input.repoPath, args, action.body ?? '')
    if (result.exitCode !== 0) {
      throw new Error(formatCommandError(result, 'Failed to create pull request'))
    }

    const url = parsePrUrlFromOutput(result.stdout) ?? parsePrUrlFromOutput(result.stderr)
    if (!url) {
      throw new Error('Pull request created, but URL could not be determined')
    }

    const loaded = await loadPullRequestByUrl(input.repoPath, url)
    const pullRequest = parsePullRequestDetails(loaded)
    if (!pullRequest) {
      throw new Error('Pull request created, but could not be loaded')
    }

    return { kind: 'created', pullRequest }
  }

  if (action.kind === 'set_ready') {
    const selectorArg = selectorToGhArg(action.selector)
    const args = ['pr', 'ready', selectorArg]
    if (action.isDraft) {
      args.push('--undo')
    }

    const result = await runCommand('gh', args, input.repoPath, {
      env: buildGhEnv(),
      timeoutMs: 30_000,
    })
    if (result.exitCode !== 0) {
      throw new Error(formatCommandError(result, 'Failed to update draft state'))
    }

    return { kind: 'completed' }
  }

  if (action.kind === 'merge') {
    const selectorArg = selectorToGhArg(action.selector)
    const args = ['pr', 'merge', selectorArg]

    if (action.method === 'squash') {
      args.push('--squash')
    } else if (action.method === 'rebase') {
      args.push('--rebase')
    } else {
      args.push('--merge')
    }

    if (action.auto) {
      args.push('--auto')
    }

    if (action.deleteBranch) {
      args.push('--delete-branch')
    }

    if (action.admin) {
      args.push('--admin')
    }

    if (action.subject?.trim()) {
      args.push('--subject', action.subject.trim())
    }

    if (action.body?.trim()) {
      args.push('--body', action.body.trim())
    }

    args.push('--yes')

    const result = await runCommand('gh', args, input.repoPath, {
      env: buildGhEnv(),
      timeoutMs: 60_000,
    })
    if (result.exitCode !== 0) {
      throw new Error(formatCommandError(result, 'Failed to merge pull request'))
    }

    return { kind: 'completed' }
  }

  if (action.kind === 'close') {
    const selectorArg = selectorToGhArg(action.selector)
    const args = ['pr', 'close', selectorArg]
    if (action.deleteBranch) {
      args.push('--delete-branch')
    }
    if (action.comment?.trim()) {
      args.push('--comment', action.comment.trim())
    }

    const result = await runCommand('gh', args, input.repoPath, {
      env: buildGhEnv(),
      timeoutMs: 30_000,
    })
    if (result.exitCode !== 0) {
      throw new Error(formatCommandError(result, 'Failed to close pull request'))
    }

    return { kind: 'completed' }
  }

  if (action.kind === 'reopen') {
    const selectorArg = selectorToGhArg(action.selector)
    const result = await runCommand('gh', ['pr', 'reopen', selectorArg], input.repoPath, {
      env: buildGhEnv(),
      timeoutMs: 30_000,
    })
    if (result.exitCode !== 0) {
      throw new Error(formatCommandError(result, 'Failed to reopen pull request'))
    }

    return { kind: 'completed' }
  }

  if (action.kind === 'comment') {
    const selectorArg = selectorToGhArg(action.selector)
    const result = await runGhWithBodyFile(
      input.repoPath,
      ['pr', 'comment', selectorArg],
      action.body,
    )
    if (result.exitCode !== 0) {
      throw new Error(formatCommandError(result, 'Failed to add comment'))
    }

    return { kind: 'completed' }
  }

  if (action.kind === 'review') {
    const selectorArg = selectorToGhArg(action.selector)
    const args = ['pr', 'review', selectorArg]
    if (action.event === 'approve') {
      args.push('--approve')
    } else if (action.event === 'request_changes') {
      args.push('--request-changes')
    } else {
      args.push('--comment')
    }

    const result = await runGhWithBodyFile(input.repoPath, args, action.body)
    if (result.exitCode !== 0) {
      throw new Error(formatCommandError(result, 'Failed to submit review'))
    }

    return { kind: 'completed' }
  }

  return { kind: 'completed' }
}
