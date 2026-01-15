import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

const squareSelector = (square: string) => `#vs-maia-square-${square}`
const pieceSelector = (square: string, piece: string) =>
  `#vs-maia-piece-${piece}-${square}`

const startGame = async (page: Page) => {
  const startButton = page.getByRole('button', { name: 'Start Game' })
  await expect(startButton).toBeEnabled()
  await startButton.click()
  await expect(page.getByRole('button', { name: 'Stop the Game' })).toBeVisible()
}

const squareCenter = async (page: Page, square: string) => {
  const locator = page.locator(squareSelector(square))
  await expect(locator).toBeVisible()
  const box = await locator.boundingBox()
  if (!box) {
    throw new Error(`Unable to locate square ${square}`)
  }
  return {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  }
}

const dragPiece = async (page: Page, from: string, to: string) => {
  const fromPoint = await squareCenter(page, from)
  const toPoint = await squareCenter(page, to)
  await page.mouse.move(fromPoint.x, fromPoint.y)
  await page.mouse.down()
  await page.mouse.move(toPoint.x, toPoint.y, { steps: 12 })
  await page.mouse.up()
}

const openSettings = async (page: Page) => {
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.locator('.settings-container')).toBeVisible()
}

const closeSettings = async (page: Page) => {
  await page.locator('.settings-close-button').click()
  await expect(page.locator('.settings-container')).toHaveCount(0)
}

const openChessEngineSettings = async (page: Page) => {
  await page.getByRole('button', { name: 'Chess Engine' }).click()
  await expect(page.getByRole('heading', { name: 'Chess Engine' })).toBeVisible()
}

const getBoardOrientation = async (page: Page) => {
  const a1Box = await page.locator(squareSelector('a1')).boundingBox()
  const h8Box = await page.locator(squareSelector('h8')).boundingBox()
  if (!a1Box || !h8Box) {
    throw new Error('Unable to read board orientation')
  }
  const isWhite = a1Box.x < h8Box.x && a1Box.y > h8Box.y
  const isBlack = a1Box.x > h8Box.x && a1Box.y < h8Box.y
  if (!isWhite && !isBlack) {
    throw new Error('Unexpected board orientation')
  }
  return isWhite ? 'white' : 'black'
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.locator('#vs-maia-board').waitFor()
})

test('drag and drop moves a pawn', async ({ page }) => {
  await startGame(page)
  await dragPiece(page, 'e2', 'e4')
  await expect(page.locator(pieceSelector('e4', 'wP'))).toBeVisible()
  await expect(page.locator(pieceSelector('e2', 'wP'))).toHaveCount(0)
})

test('click-to-move still works', async ({ page }) => {
  await startGame(page)
  await page.locator(squareSelector('e2')).click()
  await page.locator(squareSelector('e4')).click()
  await expect(page.locator(pieceSelector('e4', 'wP'))).toBeVisible()
})

test('takeback restores the last move (click-to-move)', async ({ page }) => {
  await startGame(page)
  await page.locator(squareSelector('e2')).click()
  await page.locator(squareSelector('e4')).click()
  await expect(page.locator(pieceSelector('e4', 'wP'))).toBeVisible()
  const takebackButton = page.getByRole('button', { name: /Take Back/ })
  await expect(takebackButton).toBeEnabled()
  await takebackButton.click()
  await expect(page.locator(pieceSelector('e2', 'wP'))).toBeVisible()
  await expect(page.locator(pieceSelector('e4', 'wP'))).toHaveCount(0)
})

test('settings allow ELO changes mid-game', async ({ page }) => {
  await startGame(page)
  const slider = page.getByRole('slider')
  const eloInput = page.getByRole('spinbutton')
  await expect(slider).toBeDisabled()
  await expect(eloInput).toBeDisabled()

  await openSettings(page)
  await openChessEngineSettings(page)
  const allowEloCheckbox = page.getByRole('checkbox', { name: 'Allow ELO change mid-game' })
  await allowEloCheckbox.check()
  await closeSettings(page)

  await expect(slider).toBeEnabled()
  await expect(eloInput).toBeEnabled()
})

test('settings takeback limit is enforced', async ({ page }) => {
  await openSettings(page)
  await openChessEngineSettings(page)
  const unlimitedCheckbox = page.getByRole('checkbox', { name: 'Unlimited' })
  await unlimitedCheckbox.uncheck()
  const takebackLimitInput = page
    .locator('.settings-section')
    .filter({ hasText: 'Takeback Limit' })
    .locator('input[type="number"]')
  await takebackLimitInput.fill('1')
  await closeSettings(page)

  await startGame(page)
  await page.locator(squareSelector('e2')).click()
  await page.locator(squareSelector('e4')).click()
  const takebackButton = page.getByRole('button', { name: /Take Back/ })
  await expect(takebackButton).toHaveText(/Take Back \(1\)/)
  await takebackButton.click()
  await expect(takebackButton).toBeDisabled()
})

test('analysis mode draws suggestion arrows', async ({ page }) => {
  await startGame(page)
  await page.locator(squareSelector('e2')).click()
  await page.locator(squareSelector('e4')).click()

  const analyzeButton = page.getByRole('button', { name: 'Analyze Game' })
  await expect(analyzeButton).toBeEnabled()
  await analyzeButton.click()

  await expect(page.locator('.info-panel h3')).toContainText('Analysis')
  await expect(page.locator('.analysis-arrow-canvas')).toBeVisible()
  await expect(page.locator('.analysis-arrow-canvas path')).toHaveCount(4)
})

test('playing as black triggers Maia to move first', async ({ page }) => {
  await page.getByRole('button', { name: 'Black' }).click()
  await startGame(page)
  await expect(page.locator(pieceSelector('e4', 'wP'))).toBeVisible()
  await page.locator(squareSelector('d7')).click()
  await page.locator(squareSelector('d5')).click()
  await expect(page.locator(pieceSelector('d5', 'bP'))).toBeVisible()
})

test('random color starts a playable game', async ({ page }) => {
  await page.getByRole('button', { name: 'Random' }).click()
  await startGame(page)

  const orientation = await getBoardOrientation(page)
  if (orientation === 'white') {
    await page.locator(squareSelector('e2')).click()
    await page.locator(squareSelector('e4')).click()
    await expect(page.locator(pieceSelector('e4', 'wP'))).toBeVisible()
    return
  }

  await expect(page.locator(pieceSelector('e4', 'wP'))).toBeVisible()
  await page.locator(squareSelector('e7')).click()
  await page.locator(squareSelector('e5')).click()
  await expect(page.locator(pieceSelector('e5', 'bP'))).toBeVisible()
})

// 1v1 Mode Tests
const select1v1Mode = async (page: Page) => {
  const dropdown = page.locator('.game-mode-dropdown-trigger')
  await dropdown.click()
  const oneVsOneOption = page.locator('.game-mode-dropdown-item').filter({ hasText: '1v1 Local' })
  await oneVsOneOption.click()
  await expect(dropdown).toContainText('1v1 Local')
}

test('1v1 mode selector is visible and selectable', async ({ page }) => {
  const dropdown = page.locator('.game-mode-dropdown-trigger')
  await expect(dropdown).toBeVisible()
  
  // Vs Maia should be selected by default
  await expect(dropdown).toContainText('Vs Maia')
  
  // Open dropdown
  await dropdown.click()
  const menu = page.locator('.game-mode-dropdown-menu')
  await expect(menu).toBeVisible()
  
  // Select 1v1 mode
  const oneVsOneOption = page.locator('.game-mode-dropdown-item').filter({ hasText: '1v1 Local' })
  await oneVsOneOption.click()
  
  // Verify selection
  await expect(dropdown).toContainText('1v1 Local')
  await expect(menu).toHaveCount(0) // Menu should close
})

test('1v1 mode hides ELO slider and color selector', async ({ page }) => {
  // In vs-maia mode, ELO slider and color selector are visible
  const slider = page.getByRole('slider')
  const colorToggle = page.locator('.toggle')
  
  await expect(slider).toBeVisible()
  await expect(colorToggle).toBeVisible()
  
  // Switch to 1v1 mode
  await select1v1Mode(page)
  
  // ELO slider and color selector should be hidden
  await expect(slider).toHaveCount(0)
  await expect(colorToggle).toHaveCount(0)
})

test('1v1 mode allows both players to move', async ({ page }) => {
  await select1v1Mode(page)
  await startGame(page)
  
  // White moves
  await page.locator(squareSelector('e2')).click()
  await page.locator(squareSelector('e4')).click()
  await expect(page.locator(pieceSelector('e4', 'wP'))).toBeVisible()
  
  // Black moves (no waiting for Maia)
  await page.locator(squareSelector('e7')).click()
  await page.locator(squareSelector('e5')).click()
  await expect(page.locator(pieceSelector('e5', 'bP'))).toBeVisible()
  
  // White moves again
  await page.locator(squareSelector('g1')).click()
  await page.locator(squareSelector('f3')).click()
  await expect(page.locator(pieceSelector('f3', 'wN'))).toBeVisible()
})

test('1v1 mode drag and drop works for both colors', async ({ page }) => {
  await select1v1Mode(page)
  await startGame(page)
  
  // White moves with drag
  await dragPiece(page, 'd2', 'd4')
  await expect(page.locator(pieceSelector('d4', 'wP'))).toBeVisible()
  
  // Black moves with drag
  await dragPiece(page, 'd7', 'd5')
  await expect(page.locator(pieceSelector('d5', 'bP'))).toBeVisible()
})

test('1v1 mode takeback undoes only one move', async ({ page }) => {
  await select1v1Mode(page)
  await startGame(page)
  
  // White moves
  await page.locator(squareSelector('e2')).click()
  await page.locator(squareSelector('e4')).click()
  await expect(page.locator(pieceSelector('e4', 'wP'))).toBeVisible()
  
  // Black moves
  await page.locator(squareSelector('e7')).click()
  await page.locator(squareSelector('e5')).click()
  await expect(page.locator(pieceSelector('e5', 'bP'))).toBeVisible()
  
  // Takeback should only undo Black's move
  const takebackButton = page.getByRole('button', { name: /Take Back/ })
  await takebackButton.click()
  
  // Black's move should be undone
  await expect(page.locator(pieceSelector('e7', 'bP'))).toBeVisible()
  await expect(page.locator(pieceSelector('e5', 'bP'))).toHaveCount(0)
  
  // White's move should still be there
  await expect(page.locator(pieceSelector('e4', 'wP'))).toBeVisible()
})

test('1v1 mode can be started immediately without engine', async ({ page }) => {
  await select1v1Mode(page)
  
  // Start button should be enabled even without waiting for engine
  const startButton = page.getByRole('button', { name: 'Start Game' })
  await expect(startButton).toBeEnabled()
  
  // Status should show 1v1 mode
  await expect(page.locator('.status-text')).toContainText('1v1')
})

test('game mode selector is disabled during game', async ({ page }) => {
  await startGame(page)
  
  const dropdown = page.locator('.game-mode-dropdown-trigger')
  await expect(dropdown).toBeDisabled()
})
