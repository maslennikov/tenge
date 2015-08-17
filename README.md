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

After we instantiate our model, we can start using it. Methods in general
receive an object with params and a callback as a second argument.

```javascript
articleModel.find({sort: {date: 1}, limit: 10}, function(err, docs) {
    //check err and work with docs
})
```


## API

Public API of Tenge is wrapped around
[mongojs](https://github.com/mafintosh/mongojs) `Database` and `Collection`
objects. If you consider provided interface insufficient, you can opt for using
raw objects with methods `_db()`, `_collection()`, and `_findCursor()` call.


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


#### `_collection(cb)`

Asynchronous accessor to the underlying mongojs collection object. Upon the
first access to the collection via this method, the collection initialization
will happen.

Default behavior is to ensure the custom `id` field of the collection is indexed
uniquely and hook the insert operation to automatically generate the `id` field
for each document that doesn't have it.

To override this behavior, see `_initCollection()` implementation.

Here is an example how to utilize this behavior to make Tenge automatically
create non-existent collections upon the first access (no error handling for
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


### CRUD
Tell about callback signature
Tell about params fields

#### `insert(params, cb)`

#### `find([params], [cb])`

#### `findOne([params], cb)`

#### `count([params], cb)`

#### `size([params], cb)`

#### `remove([params], cb)`

#### `updateOne(params, cb)`

#### `updateAll(params, cb)`

#### `_queryTransformers`


### Events

#### `before(action, handler)`

#### `after(action, handler)`


### Utilities

#### `makeOID([id])`

#### `makeID()`


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
- describe the absence of before-update hook
- describe the fact of not-generating a custom id during upsert
- customizible error reporting
- bulk operations (attention to upserts in
  [update](http://docs.mongodb.org/manual/reference/command/update) and
  [findAndModify](http://docs.mongodb.org/manual/reference/command/findAndModify))
- db.on('error), db.on('ready') support
