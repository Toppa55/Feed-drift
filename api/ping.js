module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).send("Feed Drift ping OK");
};
