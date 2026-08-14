import { describe, expect, it } from 'vitest'
import { sshConfigHostToDraft } from '../../../src/contexts/topology/domain/endpointFormDraft'
import { uniqueImportableSshConfigHosts } from '../../../src/contexts/topology/domain/sshConfigHost'
import { parseSshConfig } from '../../../src/contexts/topology/domain/sshConfigParse'

describe('parseSshConfig', () => {
  it('parses concrete aliases from single and multi-pattern Host blocks', () => {
    expect(
      parseSshConfig(`
        Host build
          HostName 10.0.0.8
          User deploy
          Port 2202

        Host staging production
          HostName bastion.example.com
      `),
    ).toEqual([
      { alias: 'build', hostName: '10.0.0.8', user: 'deploy', port: 2202 },
      { alias: 'staging', hostName: 'bastion.example.com', user: null, port: null },
      { alias: 'production', hostName: 'bastion.example.com', user: null, port: null },
    ])
  })

  it('filters wildcard and negated patterns while retaining concrete aliases', () => {
    expect(
      parseSshConfig(`
        Host * foo* qu? !blocked concrete
          User ubuntu
      `),
    ).toEqual([{ alias: 'concrete', hostName: null, user: 'ubuntu', port: null }])
  })

  it('ends the current Host block at Match and ignores conditional directives', () => {
    expect(
      parseSshConfig(`
        Host before-match
          HostName before.example.com
        Match user deploy
          HostName conditional.example.com
          User deploy
        Host after-match
          User root
      `),
    ).toEqual([
      { alias: 'before-match', hostName: 'before.example.com', user: null, port: null },
      { alias: 'after-match', hostName: null, user: 'root', port: null },
    ])
  })

  it('handles comments, quoted values, equals separators, and case-insensitive keywords', () => {
    expect(
      parseSshConfig(`
        hOsT "quoted alias" plain # not-a-host
          HOSTNAME="host # one.example.com" # trailing comment
          uSeR 'deploy user'
          pOrT = 2222
      `),
    ).toEqual([
      {
        alias: 'quoted alias',
        hostName: 'host # one.example.com',
        user: 'deploy user',
        port: 2222,
      },
      {
        alias: 'plain',
        hostName: 'host # one.example.com',
        user: 'deploy user',
        port: 2222,
      },
    ])
  })

  it('allows missing fields and ignores invalid ports', () => {
    expect(parseSshConfig('Host minimal\n  Port invalid')).toEqual([
      { alias: 'minimal', hostName: null, user: null, port: null },
    ])
  })

  it('returns an empty list for empty or directive-only content', () => {
    expect(parseSshConfig('')).toEqual([])
    expect(parseSshConfig('# comment\nUser nobody')).toEqual([])
  })
})

describe('sshConfigHostToDraft', () => {
  const host = {
    alias: 'build-box',
    hostName: '10.0.0.8',
    user: 'deploy',
    port: 2202,
  }

  it('maps through the Host alias and leaves OpenSSH-owned fields empty', () => {
    expect(sshConfigHostToDraft(host, [])).toEqual({
      registerMode: 'managed',
      displayName: 'build-box',
      managedHost: 'build-box',
      managedPort: '',
      managedUsername: '',
      managedRemotePort: '',
      manualHostname: '',
      manualPort: '',
      manualToken: '',
      isAlreadyAdded: false,
    })
  })

  it('normalizes alias boundaries when checking existing managed SSH hosts', () => {
    expect(sshConfigHostToDraft(host, ['other', 'BUILD-BOX']).isAlreadyAdded).toBe(true)
    expect(sshConfigHostToDraft({ ...host, alias: ' build-box ' }, []).managedHost).toBe(
      'build-box',
    )
    expect(sshConfigHostToDraft({ ...host, alias: '   ' }, ['']).isAlreadyAdded).toBe(false)
  })

  it('drops empty and duplicate aliases at the import boundary', () => {
    expect(
      uniqueImportableSshConfigHosts([
        host,
        { ...host, alias: ' BUILD-BOX ' },
        { ...host, alias: '   ' },
      ]),
    ).toEqual([host])
  })
})
