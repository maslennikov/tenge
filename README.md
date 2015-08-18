# Tenge
Thin convenience layer on top of mongojs for MongoDB operations in Node.js

General behavior tends to stay close to "native" MongoDB interface libraries
like [mongojs](https://github.com/mafintosh/mongojs) or
[mongoskin](https://github.com/kissjs/node-mongoskin). The "batteries" include:
- before- and after-operation hooks
- user- and url-friendly ID generation (by default with
  [shortid](https://github.com/dylang/shortid))
- customizable query transformers for complex query shortcuts


## Example

Before using Tenge, it should be provided a connection string URI to
MongoDB. The connection string should follow the format described in the
[mongo connection string docs](http://docs.mongodb.org/manual/reference/connection-string/).
Normally it will be done on the early configuration stage of the app. If you try
to instantiate Tenge without calling `connect()` first, you'll get an error.

```javascript
var Tenge = require('tenge')

//simple usage for local db
Tenge.connect({uri: 'mydb'})

// the db is on a remote server (the port default to mongo)
Tenge.connect({uri: 'example.com/mydb'})

//providing credentials
Tenge.connect({uri: 'username:password@example.com/mydb'})
```

Tenge is supposed to be inherited every time an interface to a new collection is
desired. So let's suppose we have a collection containing a list of articles. In
a simplest case a model layer for it can look like:

```javascript
//in a primitive case it'll work even like this
var articleModel = new Tenge({collection: 'articles'})
```

In a more advanced scenario it'll have a dedicated module:

```javascript
module.exports = ArticleModel

function ArticleModel() {
    Tenge.call(this, {collection: 'articles'})
    // some functionality extension happens here...
}
require('util').inherits(ArticleModel, Tenge)
```

Not uncommon is the situation when an application-wide model class inherits from
Tenge and registers app-specific customizations (like hooks and auto-generated
fields), and then each collection interface inherits from this app's BaseModel.


## API

Public API of Tenge is wrapped around
[mongojs](https://github.com/mafintosh/mongojs) `Database` and `Collection`
objects. If you consider provided interface insufficient, you can opt for using
raw objects with methods `_db()`, `_collection()`, and `_findCursor()` call.

Tenge methods in general receive an object with params and a callback as a
second argument.

```javascript
articleModel.find({sort: {date: 1}, limit: 10}, function(err, docs) {
    //check err and work with docs
})
```

Callback always has the standard Node.js signature:
```javascript
function callback(err, data)
```


### Initialization

#### `Tenge.connect(params)`

The static call to be made before instantiating any model.

Params:
- `params.uri`: URI describing connection to the database, according to the
format described in
[mongo connection string docs](http://docs.mongodb.org/manual/reference/connection-string/)
- `[params.authMechanism]`: authentication to MongoDB server, can be 'MongoCR'
  (default), or 'ScramSHA1' (the default auth mechanism for MongoDB 3).

Example:
```javascript
var Tenge = require('tenge')
Tenge.connect({uri: 'username:password@example.com/mydb'})
```

#### `Tenge(params)`

Constructor for model instances. Can be inherited or just used as is.

Params:
- `params.collection`: collection name to work with

See also: `_collection()`


#### `Tenge._db()`

Accessor for the underlying mongojs database object. Before using, call
`Tenge.connect()`.


#### `_collection(cb)` and collection initialization

Asynchronous accessor to the underlying mongojs collection object. Upon the
first access to the collection via this method, the collection initialization
will happen.

Default behavior is to ensure the custom `id` field of the collection is indexed
uniquely and hook the insert operation to automatically generate the `id` field
for each document that doesn't have it.

Important: no custom IDs are generated upon upsert event. If this behavior is
desirable, please consider using an after-upsert hook in a similar fashion as
the before-insert one is used for this purpose.

To override default behavior, see `_initCollection()` implementation.

Here is an example how to utilize this method to make Tenge automatically create
non-existent collections upon the first access (error handling is omitted for
brevity):

```javascript
MyModel.prototype._initCollection = function(colname, cb) {
    var self = this;
    var super = Tenge.prototype._initCollection.bind(this, colname, cb);

    Tenge._db().getCollectionNames(function(err, collections) {
        if (collections.indexOf(modelOpts.collection) > -1) {
            super();
        } else {
            Tenge._db().createCollection(colname, function(err) {
                super();
            });
        }
    });
}
```

### Events

The majority of CRUD operations described below supports before- and/or
after-hooks allowing the model layer to maintain cross-collection integrity in a
decoupled manner.

Please note that this mechanism has limited capabilities in complex environments
(for example, several application instances are running concurrently) and was
meant to be used mainly on the model level.

Events are described by the action name (often same as the CRUD method), like
'insert', 'remove', 'upsert' etc. Handlers are asynchronous functions with a
signature `function(params, next)`, chained via the `next` callback accepting an
error. The handler chain execution will be stopped after the first error passed
to the `next()`.

For `params` format, see the doc for corresponding CRUD action.


#### `before(action, handler)`

Registering a before-hook for the actions like 'insert', 'remove'. All handlers
will receive the same `params` object and are welcome to modify it in place.

Any error ocurred inside the hook will abort the whole operation and the hook
chain.

Example implementation of providing custom IDs upon insert:
```javascript
model.before('insert', function(params, next) {
    _.each(params.docs, function(doc) {
        doc.id = doc.id || self.makeID();
    });
    next();
});
```

Note that there is no before-update hook. This is done intentionally for the
reason that in multi-instance app the naïve straight-forward implementation will
lead to dangerous data integrity threats.


#### `after(action, handler)`

Registering an after-hook for the actions like 'insert', 'update', 'upsert',
'remove'.

Important: Any error ocurred inside the hook will *not* roll back the whole
operation, it will just abort the hook chain.


### CRUD

#### `insert(params, cb)`

An insert operation accepting a single document of arbitrary structure or an
array of such documents.

Params:
- `[params.doc | params.docs]`: both params are optional but any of them should
  be set.

Hooks:
- `before insert`: will receive a `params.docs` with documents to be
  inserted. Documents can be modified in-place;
- `after insert`: will receive a `params.docs` array of inserted documents, with
  ids assigned.

Returns an array of inserted documents via the callback.

Example:
```javascript
model.insert({docs: [
    {artist: 'marley'}, {artist: 'hendrix'}, {artist: 'santana'}
]}, function(err, docs) {
    _.each(docs, function(doc) {
        expect(doc).to.have.property('_id');
        expect(doc).to.have.property('id');
    });
    expect(_.uniq(_.pluck(docs, 'id'))).to.have.length(docs.length);
});
```

#### `find(params, cb)`

A simple find operation. Works as a wrapper around the mongojs cursor
operation. Below the generic find arguments are described, which are also
applicable to other find-alike mehods.

Params:
- `[params.query]`: a mongo query object
- `[params.fields]`: specification of fields ('projection') to return
- `[params.sort]`: cursor specification of sorting to match the query
- `[params.limit]`: cursor limit spec; a falsy value is treated as no limit
- `[params.skip]`: cursor skip spec

Returns a result of `toArray()` call on the mongo cursor via callback.


#### `findOne(params, cb)`

Returns the first doc of the resultset matched by all passed params. Params spec
is same as of `find()`.

#### `count(params, cb)`

Returns the total number of documents matching the query

Params:
- `[params.query]`: a mongo query object


#### `size(params, cb)`

Returns the number of documents matching the query after applying skip, and
limit conditions.

Params:
- `[params.query]`: a mongo query object
- `[params.limit]`: cursor limit spec; a falsy value is treated as no limit
- `[params.skip]`: cursor skip spec


#### `remove(params, cb)`

Removes documents matching the query filters.

Params:
- `[params.query]`: a mongo query object
- `[params.fields]`: specification of fields ('projection') to return
- `[params.sort]`: cursor specification of sorting to match the query
- `[params.limit]`: cursor limit spec; a falsy value is treated as no limit
- `[params.skip]`: cursor skip spec

Hooks:
- `before remove`: will get all objects to be removed via `params.docs`
- `after remove`: will get objects removed via `params.docs`

Returns docs removed (with filtered out fields according to the `params.fields`
spec).


#### `updateOne(params, cb)`

An update operation for a single document (implemented via `findAndModify()`).

If no document was found for update:
- if `params.upsert` was set, a new document will be upserted (*important:* no
  custom ID will be generated in this case); please refer also to
  [mongo docs about upsert and unique indexing](http://docs.mongodb.org/manual/reference/command/findAndModify/#upsert-and-unique-index);
- if `params.upsert` was not set, it will be treated as an error. If this
behavior is not desirable, use `updateAll()`.

Params:
- `params.query`: a mongo query object
- `params.(update|remove)`: mongo update object
- `[params.fields]`: specification of fields to return
- `[params.sort]`: cursor specification of sorting to match the query
- `[params.upsert]`: a truthy value means that the upsert bahavior is desired

Hooks:
- `after update`: will get object updated via `params.docs` array
- `after upsert`: will get object upserted via `params.docs` array

Returns an updated/upserted document via callback. To differentiate between
handling of upserted and updated documents, use 'after-' hooks.


#### `updateAll(params, cb)`

An update operation for multiple documents.

If no documents match the query criteria, it won't be treated as an error:
- if `params.upsert` was set, the new document will be upserted (*important:* no
  custom ID will be generated in this case);
- if `params.upsert` was not set, the call just returns an empty array as a
  result. No hooks will be triggered.

Params:
- `params.query`: a mongo query object
- `params.update`: mongo update object
- `[params.fields]`: specification of fields to return
- `[params.sort]`: cursor specification of sorting to match the query
- `[params.upsert]`: a truthy value means that the upsert bahavior is desired

Hooks:
- `after update`: will get objects updated via `params.docs` array
- `after upsert`: will get objects upserted via `params.docs` array

Returns an array of documents updated/upserted via callback. To differentiate
between handling of upserted and updated documents, use 'after-' hooks.


#### `_queryTransformers` and `params.query.$$`

There is a special case in `params.query` which is not compliant to mongo query
object format and will be processed by Tenge before passing it to mongo. This is
the `params.query.$$` field in a query object.

If this field is present, for each key in this `$$` object, a corresponding
transformer function will be called which will return an object merged into the
`params.query`.

Right now the following transformers are supported:
- `$$.id --> {id: val}`
- `$$.ids --> {id: {$in: val}}`
- `$$._id --> {_id: OID(val)}`
- `$$._ids --> {_id: {$in: val.map(OID)}}`

Example:

```javascript
// Tenge has these transformers among the default ones:
Tenge.prototype._queryTransformers = {
    id: function(val) {
        return {id: val};
    },
    ids: function(val) {
        return {id: {$in: val}};
    }
};

// using in find operation:
model.find({query: {$$: {ids: ["NkXtJhvB", "V1GQFknvH"]}}}, callback);
```



### Utilities

#### `makeOID([id])`

A convenience method to genereta a new OID or convert id string into the mongo
ObjectId if argument string is provided.

#### `makeID()`

Generates an url-friendly id (with
[shortid](https://github.com/dylang/shortid)).


# Older versions of MongoDB

As per
[mongojs doc](https://github.com/mafintosh/mongojs#features-not-supported-for-mongodb-24-or-older-on-mongojs-version-10),
for MongoDB 2.4 or older, index creation and deletion is not supported. As this
is a feature necessary for custom IDs generation, Tenge won't work out-of the
box in this case. Please consider either to submit a PR to mongojs, or implement
a workaround like this:

```javascript
module.exports = BaseModel

function BaseModel() {
    Tenge.apply(this, arguments)
}
require('util').inherits(BaseModel, Tenge)

BaseModel.prototype._initCollection = function(colname, cb) {
    var self = this;
    var col = self._db().collection(colname);

    //assuming that collection already exists and a unique index
    // over `id` field is created
    self.before('insert', function(params, next) {
        _.each(params.docs, function(doc) {
            doc.id = doc.id || self.makeID();
        });
        next();
    });

    cb(null, col);
};
```


# TODO
- customizible error reporting + mongojs + mongodb errors
- bulk operations (attention to upserts in
  [update](http://docs.mongodb.org/manual/reference/command/update) and
  [findAndModify](http://docs.mongodb.org/manual/reference/command/findAndModify))
- db.on('error), db.on('ready') support
