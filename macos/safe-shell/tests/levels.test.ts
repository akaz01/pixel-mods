import { describe, expect, test } from 'claude-code/testing'

import { classify, dangerCount } from '../hooks/levels'

const levelOf = (command: string) => classify(command)?.level

describe('classify', () => {
  test('leaves everyday commands alone', async () => {
    for (const command of ['git status', 'ls -la', 'npm test', 'git push origin main', 'diskutil list', 'git stash push -m "backup"']) {
      expect(levelOf(command)).toBeUndefined()
    }
  })

  test('marks recursive folder deletes as caution', async () => {
    expect(levelOf('rm -rf build')).toBe('caution')
    expect(levelOf('git branch -D old-feature')).toBe('caution')
    expect(levelOf('rm --recursive build')).toBe('caution')
    expect(levelOf('rm --force --recursive build')).toBe('caution')
    expect(levelOf('rm --recursively build')).toBeUndefined()
  })

  test('marks history-destroying git commands as danger with an alternative', async () => {
    const reset = classify('git reset --hard origin/main')
    expect(reset?.level).toBe('danger')
    expect(reset?.alternative).toContain('git stash')
    expect(levelOf('git push --force origin main')).toBe('danger')
    expect(levelOf('git push -f')).toBe('danger')
    expect(levelOf('git clean -fd')).toBe('danger')
    expect(levelOf('git checkout -- .')).toBe('danger')
    expect(levelOf('git restore .')).toBe('danger')
  })

  test('does not treat --force-with-lease as a plain force push', async () => {
    expect(levelOf('git push --force-with-lease')).toBe('caution')
  })

  test('forbids wiping a drive root or the home folder', async () => {
    expect(levelOf('rm -rf /')).toBe('forbidden')
    expect(levelOf('rm -rf ~')).toBe('forbidden')
    expect(levelOf('rm -rf ~/')).toBe('forbidden')
    expect(levelOf('rm -rf /Users/suhoon')).toBe('forbidden')
    expect(levelOf('rm -rf /Users')).toBe('forbidden')
  })

  test('forbids wiping a macOS system folder', async () => {
    for (const command of ['rm -rf /System', 'sudo rm -rf /Library/', 'rm -rf /Applications', 'rm -rf "/usr"', 'rm -rf /private/*', 'rm -rf /etc']) {
      expect(`${command} → ${levelOf(command)}`).toBe(`${command} → forbidden`)
    }
  })

  test('forbids erasing a disk with diskutil or dd', async () => {
    for (const command of ['diskutil eraseDisk APFS X disk4', 'sudo diskutil eraseVolume APFS X /Volumes/USB', 'diskutil zeroDisk disk4',
      'diskutil secureErase 0 disk4', 'diskutil partitionDisk disk4 GPT APFS X 100%', 'dd if=/dev/zero of=/dev/rdisk4']) {
      expect(`${command} → ${levelOf(command)}`).toBe(`${command} → forbidden`)
    }
  })

  test('forbids the quoted, wildcard and long-option forms of a root wipe', async () => {
    for (const command of [
      'rm -rf /*', 'rm -rf ~/*', 'rm -rf $HOME/*', 'rm -rf "/"', "rm -rf '/'", 'rm -rf "$HOME"', 'rm -rf "$HOME/"', 'rm -rf ${HOME}',
      'rm -rf --no-preserve-root /', 'rm -rf -- /', 'rm -rf "/Users/bob/"', 'rm --recursive --force /', 'rm -r -f /', 'sudo rm -fr /',
    ]) {
      expect(`${command} → ${levelOf(command)}`).toBe(`${command} → forbidden`)
    }
  })

  test('keeps ordinary folder deletes at caution', async () => {
    for (const command of ['rm -rf ./build', 'rm -rf /tmp/cache', 'rm -rf ~/projects/old', 'rm -rf ~/Library/Caches/old', 'rm -rf /Users/bob/projects/old', 'rm -rf /usr/local/lib/old']) {
      expect(`${command} → ${levelOf(command)}`).toBe(`${command} → caution`)
    }
  })

  test('catches git options before the subcommand and long-form forces', async () => {
    for (const command of ['git -c core.x=y reset --hard', 'git -C repo push -f', 'git clean --force', 'git checkout -f', 'git restore --worktree :/']) {
      expect(`${command} → ${levelOf(command)}`).toBe(`${command} → danger`)
    }
  })

  test('ignores dangerous words that are only printed or written in a message', async () => {
    expect(levelOf('echo "git reset --hard"')).toBeUndefined()
    expect(levelOf('git commit -m "drop table users"')).toBeUndefined()
    expect(levelOf("printf 'git push --force'")).toBeUndefined()
    expect(levelOf('echo "rm -rf /"')).toBe('forbidden')
  })

  test('counts each dangerous step in a chained command', async () => {
    expect(dangerCount('git reset --hard')).toBe(1)
    expect(dangerCount('git reset --hard && git push -f')).toBe(2)
    expect(dangerCount('git reset --hard; git reset --hard')).toBe(2)
  })

  test('picks the most severe rule when several match', async () => {
    expect(levelOf('git reset --hard && rm -rf /')).toBe('forbidden')
  })

  test('still sees a rule inside a chained or wrapped command', async () => {
    expect(levelOf('cd repo && git reset --hard')).toBe('danger')
    expect(levelOf('bash -c "git reset --hard"')).toBe('danger')
  })
})
