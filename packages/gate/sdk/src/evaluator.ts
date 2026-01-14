/**
 * Safe expression evaluator for Gate key expressions
 *
 * Custom implementation that avoids eval() and only supports
 * the specific operations needed for gate expressions.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Value = any;

/**
 * Token types for lexer
 */
type TokenType =
  | 'IDENTIFIER'
  | 'NUMBER'
  | 'STRING'
  | 'BOOLEAN'
  | 'NULL'
  | 'OPERATOR'
  | 'LPAREN'
  | 'RPAREN'
  | 'DOT'
  | 'COMMA'
  | 'EOF';

interface Token {
  type: TokenType;
  value: string;
}

/**
 * Tokenize an expression string
 */
function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    const char = expr[i];

    // Skip whitespace
    if (/\s/.test(char)) {
      i++;
      continue;
    }

    // String literals
    if (char === '"' || char === "'") {
      const quote = char;
      let str = '';
      i++;
      while (i < expr.length && expr[i] !== quote) {
        if (expr[i] === '\\' && i + 1 < expr.length) {
          i++;
          str += expr[i];
        } else {
          str += expr[i];
        }
        i++;
      }
      i++; // Skip closing quote
      tokens.push({ type: 'STRING', value: str });
      continue;
    }

    // Numbers
    if (/\d/.test(char)) {
      let num = '';
      while (i < expr.length && /[\d.]/.test(expr[i])) {
        num += expr[i];
        i++;
      }
      tokens.push({ type: 'NUMBER', value: num });
      continue;
    }

    // Identifiers and keywords
    if (/[a-zA-Z_]/.test(char)) {
      let ident = '';
      while (i < expr.length && /[a-zA-Z0-9_]/.test(expr[i])) {
        ident += expr[i];
        i++;
      }

      if (ident === 'true' || ident === 'false') {
        tokens.push({ type: 'BOOLEAN', value: ident });
      } else if (ident === 'null' || ident === 'undefined') {
        tokens.push({ type: 'NULL', value: ident });
      } else if (['and', 'or', 'not', 'includes', 'in'].includes(ident)) {
        tokens.push({ type: 'OPERATOR', value: ident });
      } else {
        tokens.push({ type: 'IDENTIFIER', value: ident });
      }
      continue;
    }

    // Operators
    if (expr.slice(i, i + 3) === '===' || expr.slice(i, i + 3) === '!==') {
      tokens.push({ type: 'OPERATOR', value: expr.slice(i, i + 3) });
      i += 3;
      continue;
    }

    if (expr.slice(i, i + 2) === '==' || expr.slice(i, i + 2) === '!=' ||
        expr.slice(i, i + 2) === '<=' || expr.slice(i, i + 2) === '>=' ||
        expr.slice(i, i + 2) === '&&' || expr.slice(i, i + 2) === '||') {
      tokens.push({ type: 'OPERATOR', value: expr.slice(i, i + 2) });
      i += 2;
      continue;
    }

    if ('<>=!'.includes(char)) {
      tokens.push({ type: 'OPERATOR', value: char });
      i++;
      continue;
    }

    // Single character tokens
    if (char === '(') {
      tokens.push({ type: 'LPAREN', value: char });
      i++;
      continue;
    }

    if (char === ')') {
      tokens.push({ type: 'RPAREN', value: char });
      i++;
      continue;
    }

    if (char === '.') {
      tokens.push({ type: 'DOT', value: char });
      i++;
      continue;
    }

    if (char === ',') {
      tokens.push({ type: 'COMMA', value: char });
      i++;
      continue;
    }

    // Unknown character - skip
    i++;
  }

  tokens.push({ type: 'EOF', value: '' });
  return tokens;
}

/**
 * Simple recursive descent parser and evaluator
 */
class ExpressionEvaluator {
  private tokens: Token[];
  private pos: number;
  private context: Record<string, Value>;

  constructor(tokens: Token[], context: Record<string, Value>) {
    this.tokens = tokens;
    this.pos = 0;
    this.context = context;
  }

  private current(): Token {
    return this.tokens[this.pos] || { type: 'EOF', value: '' };
  }

  private advance(): Token {
    const token = this.current();
    this.pos++;
    return token;
  }

  evaluate(): Value {
    return this.parseOr();
  }

  private parseOr(): Value {
    let left = this.parseAnd();

    while (this.current().value === '||' || this.current().value === 'or') {
      this.advance();
      const right = this.parseAnd();
      left = Boolean(left) || Boolean(right);
    }

    return left;
  }

  private parseAnd(): Value {
    let left = this.parseNot();

    while (this.current().value === '&&' || this.current().value === 'and') {
      this.advance();
      const right = this.parseNot();
      left = Boolean(left) && Boolean(right);
    }

    return left;
  }

  private parseNot(): Value {
    if (this.current().value === '!' || this.current().value === 'not') {
      this.advance();
      return !Boolean(this.parseNot());
    }
    return this.parseComparison();
  }

  private parseComparison(): Value {
    let left = this.parsePrimary();

    const op = this.current();
    if (op.type === 'OPERATOR') {
      switch (op.value) {
        case '==':
        case '===':
          this.advance();
          return left === this.parsePrimary();
        case '!=':
        case '!==':
          this.advance();
          return left !== this.parsePrimary();
        case '<':
          this.advance();
          return (left as number) < (this.parsePrimary() as number);
        case '>':
          this.advance();
          return (left as number) > (this.parsePrimary() as number);
        case '<=':
          this.advance();
          return (left as number) <= (this.parsePrimary() as number);
        case '>=':
          this.advance();
          return (left as number) >= (this.parsePrimary() as number);
        case 'includes':
          this.advance();
          const includesValue = this.parsePrimary();
          if (Array.isArray(left)) {
            return left.includes(includesValue);
          }
          if (typeof left === 'string') {
            return left.includes(String(includesValue));
          }
          return false;
        case 'in':
          this.advance();
          const inArray = this.parsePrimary();
          if (Array.isArray(inArray)) {
            return inArray.includes(left);
          }
          return false;
      }
    }

    return left;
  }

  private parsePrimary(): Value {
    const token = this.current();

    // Parenthesized expression
    if (token.type === 'LPAREN') {
      this.advance();
      const value = this.parseOr();
      if (this.current().type === 'RPAREN') {
        this.advance();
      }
      return value;
    }

    // String literal
    if (token.type === 'STRING') {
      this.advance();
      return token.value;
    }

    // Number literal
    if (token.type === 'NUMBER') {
      this.advance();
      return parseFloat(token.value);
    }

    // Boolean literal
    if (token.type === 'BOOLEAN') {
      this.advance();
      return token.value === 'true';
    }

    // Null literal
    if (token.type === 'NULL') {
      this.advance();
      return null;
    }

    // Identifier (variable access)
    if (token.type === 'IDENTIFIER') {
      return this.parseIdentifier();
    }

    return null;
  }

  private parseIdentifier(): Value {
    let value: Value = this.context;
    
    // Parse dotted path: user.role.name
    while (this.current().type === 'IDENTIFIER' || this.current().type === 'DOT') {
      if (this.current().type === 'DOT') {
        this.advance();
        continue;
      }

      const key = this.advance().value;
      
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        value = (value as Record<string, Value>)[key];
      } else {
        value = undefined;
      }

      // Check for method calls
      if (this.current().type === 'LPAREN') {
        this.advance(); // skip (
        const args: Value[] = [];
        
        while (this.current().type !== 'RPAREN' && this.current().type !== 'EOF') {
          args.push(this.parseOr());
          if (this.current().type === 'COMMA') {
            this.advance();
          }
        }
        
        if (this.current().type === 'RPAREN') {
          this.advance();
        }

        // Handle built-in methods
        // The value before the method is the object, key is the method name
        // We need to get the parent object and call the method
        return this.callMethod(key, value, args);
      }

      // Check for more dots
      if (this.current().type !== 'DOT') {
        break;
      }
    }

    return value;
  }

  private callMethod(method: string, target: Value, args: Value[]): Value {
    switch (method) {
      case 'includes':
        if (Array.isArray(target)) {
          return target.includes(args[0]);
        }
        if (typeof target === 'string') {
          return target.includes(String(args[0]));
        }
        return false;

      case 'startsWith':
        if (typeof target === 'string') {
          return target.startsWith(String(args[0]));
        }
        return false;

      case 'endsWith':
        if (typeof target === 'string') {
          return target.endsWith(String(args[0]));
        }
        return false;

      case 'length':
        if (Array.isArray(target) || typeof target === 'string') {
          return target.length;
        }
        return 0;

      default:
        return null;
    }
  }
}

/**
 * Evaluate a key expression against an entity context
 */
export function evaluateExpression(
  expression: string,
  context: Record<string, unknown>
): { passed: boolean; error?: string } {
  try {
    const tokens = tokenize(expression);
    const evaluator = new ExpressionEvaluator(tokens, context as Record<string, Value>);
    const result = evaluator.evaluate();

    return {
      passed: Boolean(result),
    };
  } catch (error: unknown) {
    return {
      passed: false,
      error: (error as Error).message,
    };
  }
}

/**
 * Create a context object from entity data
 * This normalizes the entity for expression evaluation
 */
export function createExpressionContext(entity: Record<string, unknown>): Record<string, unknown> {
  return entity;
}
