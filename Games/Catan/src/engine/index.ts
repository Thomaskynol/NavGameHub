// API pública do motor (CONTRATO — docs/architecture.md). Exporta exatamente o contrato.
export { generateBoard } from './mapgen';
export { createGame } from './game';
export { applyCommand } from './commands';
export { computeLongestRoad, publicVictoryPoints, totalVictoryPoints, bestBankRate } from './scores';
export { legalBuildTargets, legalRobberHexes, robberVictims } from './legal';
