# tenge
Thin convenience layer on top of mongojs for MongoDB operations in Node.js


# TODO
- hooks for remove
- describe the absence of before-update hook
- describe the fact of not-generating a custom id during upsert
- customizible error reporting
- bulk operations (attention to upserts in
  [update](http://docs.mongodb.org/manual/reference/command/update) and
  [findAndModify](http://docs.mongodb.org/manual/reference/command/findAndModify))
