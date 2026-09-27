import json, csv, re
d=json.load(open('raw.json'))
films={f['qid']:f for f in d['films']}
clean=lambda s: re.sub(r'\s+',' ',s).strip()
ok=lambda n: n and not re.fullmatch(r'Q\d+',n)
people={}; cast=[]; directed=[]; genres={}; tagged=[]
for r in d['cast']:
    if r['film'] in films and ok(r['name']): people[r['id']]=clean(r['name']); cast.append((r['film'],r['id']))
for r in d['director']:
    if r['film'] in films and ok(r['name']): people[r['id']]=clean(r['name']); directed.append((r['film'],r['id']))
for r in d['genre']:
    if r['film'] in films and ok(r['name']): genres[r['id']]=re.sub(r' film$','',clean(r['name'])); tagged.append((r['film'],r['id']))
def write(name, header, rows):
    with open(f'samples/movies-{name}.csv','w',newline='') as f:
        w=csv.writer(f); w.writerow(header); w.writerows(rows)
write('movies',['qid','title','year','gross'],[[q,clean(m['title']),m['year'] or 0,m['gross']] for q,m in films.items() if ok(m['title'])])
write('people',['qid','name'],sorted(people.items()))
write('genres',['qid','name'],sorted(genres.items()))
for name,rows in [('cast',cast),('directed',directed),('tagged',tagged)]: write(name,['movie','other'],sorted(set(rows)))
print('movies',sum(1 for m in films.values() if ok(m['title'])),'people',len(people),'cast',len(set(cast)),'directed',len(set(directed)),'tagged',len(set(tagged)))
