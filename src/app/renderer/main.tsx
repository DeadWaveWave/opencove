import { ensureRandomUuid } from './bootstrap/ensureRandomUuid'
import { installGlassGrain } from './bootstrap/installGlassGrain'
import { startDesktop } from './bootstrap/startDesktop'

ensureRandomUuid()
installGlassGrain()
void startDesktop()
