/**
 * The Maybe monad, except that pure(undefined) returns Nothing, rather than
 * Just undefined. Also, we match js's convention from Promise of not requiring
 * the user's bind() argument to always return the monad (i.e., we merge bind
 * and map); if a raw value x is returned, it's converted to Maybe(x).
 * Note: normally Nothing would be a single value not a class, but making it
 * a class helps Typescript.
 */
export type Maybe<U> = Just<U> | Nothing<U>;

// tslint:disable max-classes-per-file
export class Nothing<T> {
  getOrDefault(defaultVal?: T): T | undefined {
    return defaultVal;
  }

  bind<U>(transform: (v: T) => Maybe<U> | U | undefined): Maybe<U> {
    return this as any as Nothing<U>;
  }

  map<U>(transform: (v: T) => U | undefined): Maybe<U> {
    return this as any as Nothing<U>;
  }
}

export class Just<T> {
  private val: T;

  constructor(x: T) {
    this.val = x;
  }

  getOrDefault(defaultVal?: T): T | undefined {
    return this.val;
  }

  map<U>(transform: (v: T) => U | undefined): Maybe<U> {
    return MaybeFn(transform(this.val));
  }

  bind<U>(transform: (v: T) => Maybe<U> | U | undefined): Maybe<U> {
    const transformed = transform(this.val);

    if(transformed instanceof Just || transformed instanceof Nothing) {
      return transformed;
    }

    else {
      return MaybeFn(transformed);
    }
  }
}

const NOTHING = new Nothing<any>();
export default function MaybeFn<T>(x: T | undefined): Maybe<T> {
  // Sometimes, null is a valid value, so we only make undefined into Nothing.
  return x !== undefined ? new Just(x) : (NOTHING as Nothing<T>);
}
