# ⚠️ This package has moved to [`vlist`](https://www.npmjs.com/package/vlist)

`@floor/vlist` has been renamed to **`vlist`**. This package is a compatibility shim that re-exports everything from the new package.

## Migration

Update your `package.json`:

```diff
- "@floor/vlist": "^1.5.0"
+ "vlist": "^1.5.5"
```

Update your imports:

```diff
- import { vlist, withSelection } from '@floor/vlist'
- import '@floor/vlist/styles'
+ import { vlist, withSelection } from 'vlist'
+ import 'vlist/styles'
```

## No immediate action required

This shim transparently re-exports everything from `vlist`, so your code will continue to work without changes. However, we recommend migrating to the new package name when convenient.

## Links

- **New package:** [vlist on npm](https://www.npmjs.com/package/vlist)
- **Documentation:** [vlist.io](https://vlist.io)
- **GitHub:** [github.com/floor/vlist](https://github.com/floor/vlist)