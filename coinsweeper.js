const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
    const userDataDir = path.join(__dirname, 'custom_profile');
    const extensionPath = path.join(__dirname, 'Resource-Override-Chrome');

    const browser = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    const storageStatePath = './storageState.json';
    const storageState = JSON.parse(fs.readFileSync(storageStatePath, 'utf-8'));
    await browser.storageState(storageState);

    const page = await browser.newPage();
    await page.goto('https://web.telegram.org/k/#@BybitCoinsweeper_Bot');
    await page.getByText('Play!', { exact: true }).click();

    const iframeElement = await page.waitForSelector('.payment-verification', { timeout: 20000 });
    const iframe = await iframeElement.contentFrame();

    await page.waitForTimeout(2000);

    await iframe.getByText('Play Now', { exact: true }).click();
    const soundButton = await iframe.$('._muteButton_54jiu_1');
    await soundButton.click();

    const solver = new MineswepperSolver(iframe, 9, 6);
    while (true) {
        await solver.solve();
        console.log('Game finished. Starting a new game...');
        await page.waitForTimeout(1000);
    }

    await page.waitForTimeout(8000000);
})();

class Cell {
    constructor() {
        this.status = 'unopened';
        this.nearby = -1;
    }
}

class MineswepperSolver {
    constructor(iframe, nrows, ncols) {
        this.iframe = iframe;
        this.nrows = nrows;
        this.ncols = ncols;
        this.bombCount = 0;
        this.resetGrid();
    }

    resetGrid() {
        this.grid = Array(this.nrows)
            .fill()
            .map(() =>
                Array(this.ncols)
                    .fill()
                    .map(() => new Cell())
            );
        this.bombCount = 0;
    }

    countFlaggedBombs() {
        let flaggedCount = 0;
        for (let row = 0; row < this.nrows; row++) {
            for (let col = 0; col < this.ncols; col++) {
                if (this.grid[row][col].status === 'flagged') {
                    flaggedCount++;
                }
            }
        }
        return flaggedCount;
    }

    async openCell(row, col) {
        const index = row * this.ncols + col;
        const cells = await this.getCellsFromPage();
        await cells[index].click();
        this.detectAndFlagBombs();

        if (this.bombCount > 8) {
            await this.iframe.waitForTimeout(6000);
        } else {
            await this.iframe.waitForTimeout(300);
        }

        // Check for game end and update board state after each click
        const gameStatus = await this.checkGameEnd();
        await this.updateBoardState();
        this.printBoard();

        if (gameStatus !== 'ongoing') {
            console.log(`Game ${gameStatus}!`);
            await this.handleGameEnd(gameStatus);
            return true;
        }
        return false;
    }

    async getCellsFromPage() {
        const cellsLocator = this.iframe.locator('css=div._field_1knt0_1');
        const cells = await cellsLocator.all();
        return cells;
    }

    async checkGameEnd() {
        const winScreen = await this.iframe.$('div._winScreen_1qcks_35');
        const loseScreen = await this.iframe.$('div._loseScreen_1qcks_36');

        if (winScreen !== null) {
            return 'won';
        } else if (loseScreen !== null) {
            return 'lost';
        }
        return 'ongoing';
    }

    async handleGameEnd(gameStatus) {
        console.log(`Game ended with status: ${gameStatus}`);
        await this.iframe.waitForSelector('div._gameEnd_1qcks_1 button.primary-btn', { timeout: 5000 });
        const playAgainButton = await this.iframe.$('div._gameEnd_1qcks_1 button.primary-btn');
        if (playAgainButton) {
            await playAgainButton.click();
            console.log('Clicked "Play Again" button.');
            await this.iframe.waitForTimeout(1000);
            this.resetGrid();
        } else {
            console.log('Could not find "Play Again" button.');
        }
    }

    async resetGame() {
        const resetButton = await this.iframe.$('button._restartButton_c6be8_1');
        if (resetButton) {
            await resetButton.click();
            console.log('Game reset.');
            this.resetGrid();
            return true;
        }
        return false;
    }

    async solve() {
        let gameEnded = false;
        while (!gameEnded) {
            gameEnded = await this.openCell(4, 3); // open start cell
            if (gameEnded) {
                console.log('Game ended after opening start cell. Resetting...');
                await this.resetGame();
                continue;
            }

            while (!gameEnded) {
                this.detectAndFlagBombs();
                let safeCells = this.findSafeCells();

                if (safeCells.length === 0) {
                    const fiftyFiftyCells = this.find5050Cells();
                    if (fiftyFiftyCells.length === 0) {
                        console.log('No safe cells or 50-50 cells found. Resetting the game.');
                        if (await this.resetGame()) {
                            break;
                        } else {
                            console.log('Failed to reset the game. Solver cannot proceed further.');
                            return;
                        }
                    }
                    safeCells = [fiftyFiftyCells[0]];
                    console.log(`No safe cells found. Choosing 50-50 cell at (${safeCells[0][0]}, ${safeCells[0][1]})`);

                    // Open the 50-50 cell
                    gameEnded = await this.openCell(safeCells[0][0], safeCells[0][1]);

                    // Pause for 3 seconds and check for game end
                    await this.iframe.waitForTimeout(3000);
                    const gameStatus = await this.checkGameEnd();
                    if (gameStatus !== 'ongoing') {
                        console.log(`Game ${gameStatus} after 50-50 cell. Resetting...`);
                        await this.handleGameEnd(gameStatus);
                        gameEnded = true;
                        continue;
                    }
                } else {
                    for (const [row, col] of safeCells) {
                        gameEnded = await this.openCell(row, col);
                        if (gameEnded) {
                            console.log('Game ended. Resetting...');
                            await this.resetGame();
                            break;
                        }
                        console.log(`Opened cell at (${row}, ${col})`);
                    }
                }
            }
        }
    }

    async updateBoardState() {
        const cells = await this.getCellsFromPage();
        for (let i = 0; i < cells.length; i++) {
            const row = Math.floor(i / this.ncols);
            const col = i % this.ncols;
            const gridCell = this.grid[row][col];

            const isOpen = await cells[i].evaluate((node) => node.classList.contains('open'));

            if (isOpen && gridCell.status !== 'opened') {
                gridCell.status = 'opened';

                const imgAlt = await cells[i].evaluate((node) => {
                    const img = node.querySelector('img');
                    return img ? img.getAttribute('alt') : null;
                });

                gridCell.nearby = imgAlt ? parseInt(imgAlt.split(' ')[1]) : 0;
            }
        }
    }

    detectAndFlagBombs() {
        let changed;
        do {
            changed = false;
            for (let row = 0; row < this.nrows; row++) {
                for (let col = 0; col < this.ncols; col++) {
                    const cell = this.grid[row][col];
                    if (cell.status === 'opened' && cell.nearby > 0) {
                        const neighbors = this.getNeighbors(row, col);
                        const unopenedNeighbors = neighbors.filter(([r, c]) => this.grid[r][c].status === 'unopened');
                        const flaggedNeighbors = neighbors.filter(([r, c]) => this.grid[r][c].status === 'flagged');

                        if (unopenedNeighbors.length + flaggedNeighbors.length === cell.nearby) {
                            for (const [r, c] of unopenedNeighbors) {
                                if (this.grid[r][c].status !== 'flagged') {
                                    this.grid[r][c].status = 'flagged';
                                    changed = true;
                                    this.bombCount++;
                                    console.log(`Flagged bomb at (${r}, ${c}) bombCount now at ${this.bombCount}`);
                                }
                            }
                        }
                    }
                }
            }
        } while (changed);
    }

    findSafeCells() {
        const safeCells = [];

        for (let row = 0; row < this.nrows; row++) {
            for (let col = 0; col < this.ncols; col++) {
                const cell = this.grid[row][col];
                if (cell.status === 'opened' && cell.nearby >= 0) {
                    const neighbors = this.getNeighbors(row, col);
                    const unopenedNeighbors = neighbors.filter(([r, c]) => this.grid[r][c].status === 'unopened');
                    const flaggedNeighbors = neighbors.filter(([r, c]) => this.grid[r][c].status === 'flagged');

                    if (flaggedNeighbors.length === cell.nearby) {
                        safeCells.push(...unopenedNeighbors);
                    }
                }
            }
        }

        return safeCells;
    }

    find5050Cells() {
        const fiftyFiftyCells = [];

        for (let row = 0; row < this.nrows; row++) {
            for (let col = 0; col < this.ncols; col++) {
                const cell = this.grid[row][col];
                if (cell.status === 'opened' && cell.nearby > 0) {
                    const neighbors = this.getNeighbors(row, col);
                    const unopenedNeighbors = neighbors.filter(([r, c]) => this.grid[r][c].status === 'unopened');
                    const flaggedNeighbors = neighbors.filter(([r, c]) => this.grid[r][c].status === 'flagged');

                    if (unopenedNeighbors.length === 2 && cell.nearby - flaggedNeighbors.length === 1) {
                        fiftyFiftyCells.push(...unopenedNeighbors);
                    }
                }
            }
        }

        return fiftyFiftyCells;
    }

    getNeighbors(row, col) {
        const neighbors = [];
        for (let i = -1; i <= 1; i++) {
            for (let j = -1; j <= 1; j++) {
                if (i === 0 && j === 0) continue;
                const newRow = row + i;
                const newCol = col + j;
                if (newRow >= 0 && newRow < this.nrows && newCol >= 0 && newCol < this.ncols) {
                    neighbors.push([newRow, newCol]);
                }
            }
        }
        return neighbors;
    }

    printBoard() {
        let output = '';
        for (let row = 0; row < this.nrows; row++) {
            for (let col = 0; col < this.ncols; col++) {
                switch (this.grid[row][col].status) {
                    case 'unopened':
                        output += 'u';
                        break;
                    case 'flagged':
                        output += 'f';
                        break;
                    case 'opened':
                        output += this.grid[row][col].nearby;
                        break;
                    default:
                        output += '-1';
                        break;
                }
            }
            output += '\n';
        }
        console.log(output);
    }
}
