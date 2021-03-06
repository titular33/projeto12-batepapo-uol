import express from "express";
import { MongoClient,ObjectId } from "mongodb";
import cors from "cors";
import Joi from "joi";
import dotenv from "dotenv";
import dayjs from "dayjs";
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// MONGODB!
const mongoClient = new MongoClient(process.env.MONGO_URI);
let db;
mongoClient.connect().then(() => {
    db = mongoClient.db(process.env.DATABASE);
});


const newParticipantSchema = Joi.object({
    name: Joi.string().required(),
});


const newMessageSchema = Joi.object({
    from: Joi.string().required(),
    to: Joi.string().required(),
    text: Joi.string().required(),
    type: Joi.string().pattern(/^(private_message|message)$/),
    time: Joi.any(),
});

app.listen(process.env.PORT, () => {
    console.log("Server running on port", process.env.PORT);
});


app.get("/participants", async (req, res) => {
    try {
        const users = await db.collection("users").find().toArray();
        res.send(users);
    } catch (error) {
        res.sendStatus(500);
    }
});

app.post("/participants", async (req, res) => {
    const newParticipant = req.body;

    try {
        await newParticipantSchema.validateAsync(newParticipant, {
            abortEarly: false,
        });
    } catch (error) {
        res.status(422).send(error.details.map((err) => err.message));
        return;
    }

    const user = await db
        .collection("users")
        .findOne({ name: newParticipant.name });

    if (user) {
        res.sendStatus(409);
        return;
    }

    const registerUserMessage = {
        from: newParticipant.name,
        to: "Todos",
        text: "entra na sala...",
        type: "status",
        time: dayjs().format("HH:mm:ss"),
    };

    try {
        await db.collection("users").insertOne({
            ...newParticipant,
            lastStatus: Date.now(),
        });

        await db.collection("messages").insertOne({
            ...registerUserMessage,
        });

        res.sendStatus(201);
    } catch (error) {
        res.sendStatus(500);
    }
});

app.get("/messages", async (req, res) => {
    const limit = parseInt(req.query.limit);
    const { user } = req.headers;

    let messages = [];

    try {
        if (limit) {
            messages = await db
                .collection("messages")
                .find({}, { limit, sort: { time: -1 } })
                .toArray();
        } else {
            messages = await db.collection("messages").find().toArray();
        }

        const filteredMessages = messages.filter((message) => {
            if (
                message.type === "private_message" &&
                (message.to === user || message.from === user)
            )
                return true;
            else if (message.type === "private_message") return false;
            else return true;
        });

        if (limit) {
            res.send([...filteredMessages].reverse());
            return;
        } else {
            res.send(filteredMessages);
            return;
        }
    } catch (error) {
        res.sendStatus(500);
    }
});
app.post("/messages", async (req, res) => {
    const { user } = req.headers;
    const userExists = await db.collection("users").findOne({ name: user });

    if (!userExists) {
        res.sendStatus(422);
        return;
    }
    const newMessage = {
        ...req.body,
        from: user,
        time: dayjs().format("HH:mm:ss"),
    };

    try {
        await newMessageSchema.validateAsync(newMessage, {
            abortEarly: false,
        });
    } catch (error) {
        res.status(422).send(error.details.map((err) => err.message));
        return;
    }
    try {
        await db.collection("messages").insertOne({ ...newMessage });
        res.sendStatus(201);
    } catch (error) {
        res.sendStatus(500);
    }
});

app.delete("/messages/:messageId", async (req, res) => {
    const { messageId } = req.params;
    const { user } = req.headers;

    let message;
    try {
        message = await db
            .collection("messages")
            .findOne({ _id: new ObjectId(messageId) });
    } catch (err) {
        res.sendStatus(404);
        return;
    }

    if (message.from !== user) {
        res.sendStatus(401);
        return;
    }

    try {
        const deletedMessage = await db
            .collection("messages")
            .deleteOne({ _id: new ObjectId(messageId) });

        if (deletedMessage.deletedCount === 1) {
            res.sendStatus(200);
            return;
        } else {
            res.sendStatus(404);
            return;
        }
    } catch (err) {
        res.sendStatus(500);
    }
});
//fase de teste put.
app.put("/messages/:messageId", async (req, res) => {
    const { messageId } = req.params;
    const { user } = req.headers;

    const editedMessage = {
        ...req.body,
        from: user,
    };

    try {
        await newMessageSchema.validateAsync(editedMessage, {
            abortEarly: false,
        });
    } catch (error) {
        res.status(422).send(error.details.map((err) => err.message));
        return;
    }

    try {
        const foundMessage = await db
            .collection("messages")
            .findOne({ _id: new ObjectId(messageId) });

        if (!foundMessage) {
            res.sendStatus(404);
            return;
        } else if (foundMessage.from !== user) {
            res.sendStatus(401);
            return;
        }

        try {
            const updateConfirmation = await db
                .collection("messages")
                .updateOne(
                    { _id: foundMessage._id },
                    { $set: { ...editedMessage } }
                );
            if (updateConfirmation.modifiedCount > 0) {
                res.sendStatus(202);
                return;
            } else {
                res.sendStatus(404);
                return;
            }
        } catch (error) {
            res.sendStatus(404);
            return;
        }
    } catch (error) {
        res.sendStatus(404);
        return;
    }
});
app.post("/status", async (req, res) => {
    const { user } = req.headers;

    const foundUser = await db.collection("users").findOne({ name: user });

    if (!foundUser) {
        res.sendStatus(404);
        return;
    }

    await db.collection("users").updateOne(
        {
            name: user,
        },
        { $set: { lastStatus: Date.now() } }
    );

    res.sendStatus(200);
});

(function checkActiveUsers() {
    setInterval(async () => {
        const users = await db
            .collection("users")
            .find()
            .forEach(async (user) => {
                if (Date.now() - user.lastStatus >= 10000) {
                    const deletedUser = await db
                        .collection("users")
                        .deleteOne({ name: user.name });
                    if (deletedUser.deletedCount === 1) {
                        const deletedMessage = {
                            from: user.name,
                            to: "Todos",
                            text: "sai da sala...",
                            type: "status",
                            time: dayjs().format("HH:mm:ss"),
                        };

                        await db
                            .collection("messages")
                            .insertOne({ ...deletedMessage });
                    } else console.log("N??o consegui deletar o usu??rio");
                }
            });
    }, 15000);
})();