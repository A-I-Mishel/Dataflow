"""FILE: backend/transforms/create_column.py
PURPOSE: 'create-column' step — one pandas op + pandas code string.
HOW IT FITS: engine.py _TRANSFORMS["create-column"] -> apply_create_column(df, config) -> (new_df, code_line).
CONFIG: uses NodeConfig.columns + op-specific fields (see models.py). Missing column -> 400 error.
WHERE TO EDIT (EXAM/BEGINNER): change the pandas line near the end + the f-string code line together or preview differs from exported code.
EXAMPLE: df before/after + code "df = df.<op>(...)" — keep both in sync.
"""
"""Safe arithmetic formulas for create-column, e.g. "[price] * [quantity]".

Grammar (shared with the Sieve twin, which parses the identical language):

    expr    := term (('+' | '-') term)*
    term    := factor (('*' | '/') factor)*
    factor  := number | '[' name ']' | '(' expr ')' | '-' factor

Deliberately small: column refs in [brackets], decimal numbers, the four
operators, parentheses, unary minus. There is intentionally NO function
calls, attributes, or names — the parser cannot even represent arbitrary
Python, so user formulas are never executed, only interpreted.
"""

import re
from typing import Dict, List, Optional, Tuple, Union

import numpy as np
import pandas as pd
from fastapi import HTTPException

from models import NodeConfig
from transforms.text_compat import coerce_numeric

AST = Union[Tuple[str, float], Tuple[str, str], Tuple[str, str, object, object], Tuple[str, object]]

_NUMBER_RE = re.compile(r"\d+(\.\d+)?|\.\d+")


def tokenize(formula: str) -> List[object]:
    tokens: List[object] = []
    i, n = 0, len(formula)
    while i < n:
        ch: str = formula[i]
        if ch.isspace():
            i += 1
            continue
        if ch in "+-*/()":
            tokens.append(ch)
            i += 1
            continue
        if ch == "[":
            j: int = formula.find("]", i + 1)
            if j < 0:
                raise HTTPException(status_code=400, detail="create-column: unclosed [column] reference")
            name: str = formula[i + 1 : j].strip()
            if not name:
                raise HTTPException(status_code=400, detail="create-column: empty [] reference")
            tokens.append(("col", name))
            i = j + 1
            continue
        match = _NUMBER_RE.match(formula, i)
        if match:
            tokens.append(("num", float(match.group(0))))
            i += len(match.group(0))
            continue
        raise HTTPException(
            status_code=400,
            detail=f"create-column: unexpected character {ch!r} (columns go in [brackets])",
        )
    return tokens


class _Parser:
    # Depth cap: deeply nested parens/unary-minus recurse per level, and an
    # uncapped formula turns into a RecursionError (confusing 400 at best).
    MAX_DEPTH: int = 50

    def __init__(self, tokens: List[object]) -> None:
        self.tokens = tokens
        self.pos = 0
        self.depth = 0

    def peek(self) -> Optional[object]:
        return self.tokens[self.pos] if self.pos < len(self.tokens) else None

    def next(self) -> object:
        tok = self.peek()
        if tok is None:
            raise HTTPException(status_code=400, detail="create-column: formula ends mid-expression")
        self.pos += 1
        return tok

    def _deeper(self) -> None:
        self.depth += 1
        if self.depth > self.MAX_DEPTH:
            raise HTTPException(
                status_code=400, detail="create-column: formula nests too deeply (max 50)"
            )

    def _shallower(self) -> None:
        self.depth -= 1

    def parse(self) -> AST:
        node = self.parse_expr()
        if self.peek() is not None:
            raise HTTPException(status_code=400, detail="create-column: trailing input after formula")
        return node

    def parse_expr(self) -> AST:
        node = self.parse_term()
        while self.peek() in ("+", "-"):
            op = self.next()
            node = ("bin", op, node, self.parse_term())
        return node

    def parse_term(self) -> AST:
        node = self.parse_factor()
        while self.peek() in ("*", "/"):
            op = self.next()
            node = ("bin", op, node, self.parse_factor())
        return node

    def parse_factor(self) -> AST:
        tok = self.next()
        if isinstance(tok, tuple):
            return tok  # ('col', name) or ('num', value)
        if tok == "(":
            self._deeper()
            try:
                node = self.parse_expr()
                if self.next() != ")":
                    raise HTTPException(status_code=400, detail="create-column: unbalanced parenthesis")
                return node
            finally:
                self._shallower()
        if tok == "-":
            self._deeper()
            try:
                return ("neg", self.parse_factor())
            finally:
                self._shallower()
        raise HTTPException(
            status_code=400, detail="create-column: expected a number, [column] or '('"
        )


def parse_formula(formula: Optional[str]) -> AST:
    if not formula or not str(formula).strip():
        raise HTTPException(status_code=400, detail="create-column: type a formula")
    return _Parser(tokenize(str(formula))).parse()


def referenced_columns(tree: AST) -> List[str]:
    refs: List[str] = []

    def _walk(node: AST) -> None:
        if node[0] == "col" and node[1] not in refs:
            refs.append(node[1])  # type: ignore[arg-type]
        elif node[0] == "bin":
            _walk(node[2])  # type: ignore[arg-type]
            _walk(node[3])  # type: ignore[arg-type]
        elif node[0] == "neg":
            _walk(node[1])  # type: ignore[arg-type]

    _walk(tree)
    return refs


def eval_frame(tree: AST, frame: Dict[str, pd.Series]) -> Union[pd.Series, float]:
    kind = tree[0]
    if kind == "num":
        return tree[1]  # type: ignore[return-value]
    if kind == "col":
        return frame[tree[1]]  # type: ignore[index]
    if kind == "neg":
        return -eval_frame(tree[1], frame)  # type: ignore[arg-type]
    _, op, left, right = tree
    lv = eval_frame(left, frame)  # type: ignore[arg-type]
    rv = eval_frame(right, frame)  # type: ignore[arg-type]
    if op == "+":
        return lv + rv
    if op == "-":
        return lv - rv
    if op == "*":
        return lv * rv
    return lv / rv  # '/' only: division by zero yields inf, cleaned by caller.


def to_source(tree: AST) -> str:
    """AST back to pandas source (codegen mirrors the interpreter exactly)."""
    kind = tree[0]
    if kind == "num":
        value: float = tree[1]  # type: ignore[assignment]
        return str(int(value)) if value.is_integer() else repr(value)
    if kind == "col":
        return f"df[{tree[1]!r}]"
    if kind == "neg":
        return f"(-{to_source(tree[1])})"  # type: ignore[arg-type]
    _, op, left, right = tree
    return f"({to_source(left)} {op} {to_source(right)})"  # type: ignore[arg-type]


def apply_create_column(df: pd.DataFrame, config: NodeConfig) -> Tuple[pd.DataFrame, str]:
    output: Optional[str] = config.output
    if not output or not str(output).strip():
        raise HTTPException(status_code=400, detail="create-column: name the output column")
    output = str(output).strip()
    if output in df.columns:
        raise HTTPException(
            status_code=400, detail=f'create-column: column "{output}" already exists'
        )
    tree: AST = parse_formula(config.formula)
    refs: List[str] = referenced_columns(tree)
    if not refs:
        raise HTTPException(status_code=400, detail="create-column: reference at least one [column]")
    missing: List[str] = [c for c in refs if c not in df.columns]
    if missing:
        raise HTTPException(status_code=400, detail=f"create-column: unknown columns {missing}")
    frame: Dict[str, pd.Series] = {c: coerce_numeric(df, c, "create-column") for c in refs}
    values = eval_frame(tree, frame)
    result: pd.DataFrame = df.copy(deep=True)
    result[output] = pd.Series(values, index=df.index).replace([np.inf, -np.inf], np.nan)
    code: str = (
        f"df[{output!r}] = {to_source(tree)}\n"
        f"df[{output!r}] = df[{output!r}].replace([np.inf, -np.inf], np.nan)"
    )
    return result, code
