import express from "express";
import cors from "cors"
import { MongoClient, ObjectId } from "mongodb";
import dotenv from "dotenv"
import dayjs from "dayjs";
import Joi from "joi";
import { strict as assert } from "assert";
import { stripHtml } from "string-strip-html";

// ------------------------------------------------------------------- CONSTs

const app = express();
const PORT = 5000;
const MAXINACTIVETIME = 10000;
const UPDATEINACTIVEUSERSTIME = 15000;
const HOURFORMAT = "HH:mm:ss";

// ------------------------------------------------------------------- server config

dotenv.config();
app.use(express.json());
app.use(cors());
app.listen(PORT, () => {
    console.log(`Servidor aberto na porta ${PORT}`);
});

// ------------------------------------------------------------------- mongo config

const mongoClient = new MongoClient(process.env.DATABASE_URL);
let db;
try {
    await mongoClient.connect();
    db = mongoClient.db();
} catch (err) {
    console.log(err);
}

// ------------------------------------------------------------------- /participants


app.get("/participants", async (req, res) => {
    try {
        const USERLIST = await db.collection("participants").find({}).toArray();
        res.send(USERLIST);
    } catch (err) {
        console.log(err);
    }
});

app.post("/participants", async (req, res) => {
    // Validation
    const schema = Joi.object({
        name: Joi.string().required(),
    })
    // Checks Validation
    const { error } = schema.validate(req.body);
    if (error) return res.sendStatus(422);
    // User to save
    const user = {
        name: stripHtml(req.body.name.trim()).result,
        lastStatus: Date.now()
    };
    try {
        const USERAVAILABLE = await db.collection("participants").findOne({ name: user.name });
        if (!USERAVAILABLE) {
            const statusMessage = {
                from: user.name,
                to: 'Todos',
                text: 'entra na sala...',
                type: 'status',
                time: dayjs().format(HOURFORMAT)
            };
            await db.collection("messages").insertOne(statusMessage);
            await db.collection("participants").insertOne(user);
            res.sendStatus(201);
        } else {
            res.sendStatus(409);
        }
    } catch (err) {
        console.log(err);
    }
});


// ------------------------------------------------------------------- /messages


app.get("/messages", async (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit) : false;
    const { user } = req.headers;
    const queryOperator = {
        $or: [
            {
                type: "private_message",
                from: user
            },
            {
                type: "private_message",
                to: user
            },
            { type: "message" },
            { type: "status" }
        ]
    };
    try {
        const MESSAGELIST = await db.collection("messages")
            .find(queryOperator).toArray();
        if (isNaN(limit) || limit < 0 || limit === 0) {
            return res.sendStatus(422);
        } else if (limit > 0) {
            return res.send(MESSAGELIST.slice(-limit).reverse());
        } else {
            return res.send(MESSAGELIST.reverse());
        }

    } catch (err) {
        console.log(err);
    }
});

app.post("/messages", async (req, res) => {
    // Validation
    const schema = Joi.object({
        to: Joi.string().required(),
        text: Joi.string().required(),
        type: Joi.string().valid("message", "private_message").required()
    })
    // Checks validation
    const { value, error } = schema.validate(req.body);
    if (error || !req.headers.user) return res.sendStatus(422);
    // Continues without validation errors
    const username = stripHtml(req.headers.user).result;
    const CHECKUSER = await db.collection("participants").findOne({ name: username });
    try {
        if (CHECKUSER) {
            const message = {
                to: stripHtml(value.to).result,
                text: stripHtml(value.text).result,
                type: stripHtml(value.type).result,
                from: username,
                time: dayjs().format(HOURFORMAT)
            };
            await db.collection("messages").insertOne(message);
            return res.sendStatus(201);
        } else {
            return res.sendStatus(422);
        }
    } catch (err) {
        console.log(err);
    }
});

app.delete("/messages/:id", async (req, res) => {
    const { user } = req.headers;
    const id = ObjectId(req.params.id);
    try {
        const message = await db.collection("messages").findOne({ _id: id });
        if (!message) {
            res.sendStatus(404);
        } else if (message.from === user) {
            await db.collection("messages").deleteOne({ _id: id });
            return res.sendStatus(200);
        } else {
            return res.sendStatus(401);
        }
    } catch (err) {
        console.log(err);
    }
});

app.put("/messages/:id", async (req, res) => {
    // Validation
    const schema = Joi.object({
        to: Joi.string().required(),
        text: Joi.string().required(),
        type: Joi.string().valid("message", "private_message").required()
    });
    // Checks validation
    const { error } = schema.validate(req.body);
    // Continues
    const { user } = req.headers;
    const id = ObjectId(req.params.id);
    const CHECKUSER = await db.collection("participants").findOne({ name: user });
    const { to, text, type } = req.body;
    if (!CHECKUSER || !user || error) return res.sendStatus(422);
    try {
        const message = await db.collection("messages").findOne({ _id: id });
        if (!message) {
            res.sendStatus(404);
        } else if (message.from === user) {
            await db.collection("messages").updateOne({ _id: id }, {
                $set: {
                    to: to,
                    text: text,
                    type: type
                }
            });
            return res.sendStatus(200);
        } else {
            return res.sendStatus(401);
        }
    } catch (err) {
        console.log(err);
    }
});


// ------------------------------------------------------------------- /status

app.post("/status", async (req, res) => {
    const { user } = req.headers;
    try {
        const USERCHECK = await db.collection("participants")
            .findOne({ name: user });
        if (USERCHECK) {
            await db.collection("participants")
                .updateOne({ name: user },
                    {
                        $set: { lastStatus: Date.now() }
                    });
            return res.sendStatus(200);
        } else {
            return res.sendStatus(404);
        }
    } catch (err) {
        console.log(err);
    }
});

setInterval(InactiveUserRemove, UPDATEINACTIVEUSERSTIME)
async function InactiveUserRemove() {
    const time = Date.now() - MAXINACTIVETIME;
    try {
        const USERSTHATLEFT = await db.collection("participants")
            .find({ lastStatus: { $lt: time } }).toArray();
        USERSTHATLEFT.map(async (e) => {
            const statusMessage = {
                from: e.name,
                to: 'Todos',
                text: 'sai da sala...',
                type: 'status',
                time: dayjs().format(HOURFORMAT)
            };
            await db.collection("messages").insertOne(statusMessage);
        })
        await db.collection("participants")
            .deleteMany({ lastStatus: { $lt: time } });
    } catch (err) {
        console.log(err);
    }
}