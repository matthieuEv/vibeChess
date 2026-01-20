import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

const squareSelector = (square: string) => `#vs-maia-square-${square}`
const pieceSelector = (square: string, piece: string) =>
  `#vs-maia-piece-${piece}-${square}`

const goToApp = async (page: Page) => {
  await page.goto('/')
  await page.locator('#vs-maia-board').waitFor()
}

const selectOnlineMode = async (page: Page) => {
  const dropdown = page.locator('.game-mode-dropdown-trigger')
  await dropdown.click()
  const onlineOption = page.locator('.game-mode-dropdown-item').filter({ hasText: 'Online' })
  await onlineOption.click()
  await expect(dropdown).toContainText('Online')
  await expect(page.locator('.online-panel')).toBeVisible()
}

const createOnlineGame = async (page: Page) => {
  await selectOnlineMode(page)
  const createButton = page.getByRole('button', { name: 'Create game' })
  await expect(createButton).toBeEnabled()
  await createButton.click()
  const code = page.locator('.online-code-value')
  await expect(code).toBeVisible()
  const gameId = (await code.textContent())?.trim()
  if (!gameId) {
    throw new Error('Expected a game id')
  }
  return gameId
}

const joinOnlineGame = async (page: Page, gameId: string) => {
  await selectOnlineMode(page)
  const input = page.getByPlaceholder('AB12-CD34')
  await input.fill(gameId)
  const joinButton = page.getByRole('button', { name: 'Join' })
  await expect(joinButton).toBeEnabled()
  await joinButton.click()
  await expect(page.locator('.online-code-value')).toHaveText(gameId)
}

test('online mode can create a game and waits for opponent', async ({ page }) => {
  await goToApp(page)
  const gameId = await createOnlineGame(page)
  expect(gameId).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
  await expect(page.locator('.status-text')).toContainText('Waiting for opponent')
})

test('online mode syncs moves between players', async ({ browser }) => {
  const whiteContext = await browser.newContext()
  const blackContext = await browser.newContext()

  try {
    const whitePage = await whiteContext.newPage()
    const blackPage = await blackContext.newPage()
    await goToApp(whitePage)
    await goToApp(blackPage)

    const gameId = await createOnlineGame(whitePage)
    await joinOnlineGame(blackPage, gameId)

    await expect(whitePage.locator('.status-text')).toContainText('Opponent connected')
    await expect(blackPage.locator('.status-text')).toContainText('Opponent connected')
    const whiteTurnIndicator = whitePage.locator('.online-turn-indicator')
    const blackTurnIndicator = blackPage.locator('.online-turn-indicator')
    await expect(whiteTurnIndicator).toHaveText('Your turn')
    await expect(blackTurnIndicator).toHaveText('Opponent turn')

    await whitePage.locator(squareSelector('e2')).click()
    await whitePage.locator(squareSelector('e4')).click()
    await expect(whitePage.locator(pieceSelector('e4', 'wP'))).toBeVisible()
    await expect(blackPage.locator(pieceSelector('e4', 'wP'))).toBeVisible()

    await expect(whiteTurnIndicator).toHaveText('Opponent turn')
    await expect(blackTurnIndicator).toHaveText('Your turn')

    await blackPage.locator(squareSelector('e7')).click()
    await blackPage.locator(squareSelector('e5')).click()
    await expect(blackPage.locator(pieceSelector('e5', 'bP'))).toBeVisible()
    await expect(whitePage.locator(pieceSelector('e5', 'bP'))).toBeVisible()

    await expect(whiteTurnIndicator).toHaveText('Your turn')
    await expect(blackTurnIndicator).toHaveText('Opponent turn')
  } finally {
    await whiteContext.close()
    await blackContext.close()
  }
})
