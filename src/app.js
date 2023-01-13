import express from "express";
import cors from "cors"
import { MongoClient } from "mongodb";
import dotenv from "dotenv"
import dayjs from "dayjs";
import Joi from "joi";

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

app.post("/participants", async (req, res) => {
    // Validation
    const schema = Joi.object({
        name: Joi.string().required(),
    })
    // Checks Validation
    const { error } = schema.validate(req.body);
    if (error) return res.sendStatus(422);
    // User to save
    const user = { ...req.body, lastStatus: Date.now() };
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

app.get("/participants", async (req, res) => {
    try {
        const USERLIST = await db.collection("participants").find({}).toArray();
        res.send(USERLIST);
    } catch (err) {
        console.log(err);
    }
});

// ------------------------------------------------------------------- /messages

app.post("/messages", async (req, res) => {
    // Validation
    const schema = Joi.object({
        to: Joi.string().required(),
        text: Joi.string().required(),
        type: Joi.string().valid("message", "private_message").required()
    })
    // Checks validation
    const { error } = schema.validate(req.body);
    if (error) return res.sendStatus(422);
    // Continues without validation errors
    const username = req.headers.user;
    const CHECKUSER = await db.collection("participants").findOne({ name: username });
    try {
        if (CHECKUSER) {
            const message = {
                ...req.body,
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
        if (limit || isNaN(limit) || limit === 0) {
            if (isNaN(limit) || limit <= 0) {
                return res.sendStatus(422);
            } else if (limit > 0) {
                return res.send(MESSAGELIST.slice(-limit));
            }
        } else {
            return res.send(MESSAGELIST);
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