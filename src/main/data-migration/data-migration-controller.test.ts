import { describe, expect, it } from 'vitest'
import { publicMigrationError } from './data-migration-controller'

describe('data migration public IPC errors', () => {
  it('provides a stable code, destination impact, and next action without credentials or stack lines', () => {
    const message = publicMigrationError(
      new Error('write failed ENOSPC\nBearer super-secret-token'),
      'staging'
    )
    expect(message).toContain('SPACE_INSUFFICIENT:')
    expect(message).toContain('Destination impact: staged temporary data only')
    expect(message).toContain('Next action:')
    expect(message).not.toContain('super-secret-token')
    expect(message).not.toContain('\n')
  })

  it('directs interrupted operations back to recovery before another mutation', () => {
    expect(publicMigrationError(new Error('migration recovery is required before starting another operation')))
      .toMatch(/^RECOVERY_REQUIRED:.*Open Data migration/)
  })
})
