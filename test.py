import json
W = json.load(open('wordfreq-en-25000-log.json'))

W = sorted(W, key=lambda x: x[1], reverse=True)
for w, f in W:
    if len(w) > 3:
        print(w)
