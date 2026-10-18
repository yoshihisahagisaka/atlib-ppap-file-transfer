// Test transport only; no socket, SMTP credentials, or real mail delivery.
const messages=[];
module.exports={messages,createTransport:()=>({sendMail:async message=>{messages.push(message);return {accepted:message.to}}})};
