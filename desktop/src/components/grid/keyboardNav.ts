export interface CellPos { row: number; col: number; }

export function nextCell(pos: CellPos, key: string, rowCount: number, colCount: number): CellPos {
  let { row, col } = pos;
  switch (key) {
    case "ArrowRight":
      col = Math.min(col + 1, colCount - 1); break;
    case "ArrowLeft":
      col = Math.max(col - 1, 0); break;
    case "ArrowDown":
      row = Math.min(row + 1, rowCount - 1); break;
    case "ArrowUp":
      row = Math.max(row - 1, 0); break;
    case "Tab":
      if (col + 1 < colCount) col += 1;
      else { col = 0; row = Math.min(row + 1, rowCount - 1); }
      break;
    case "Shift+Tab":
      if (col - 1 >= 0) col -= 1;
      else { col = colCount - 1; row = Math.max(row - 1, 0); }
      break;
    default:
      return pos;
  }
  return { row, col };
}