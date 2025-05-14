from flask import Flask, send_from_directory, render_template
import os

app = Flask(__name__, static_folder='.', template_folder='.')
# static_folder='.'  يعني أن Flask سيبحث عن الملفات الثابتة (CSS, JS, Images) في نفس مجلد app.py
# template_folder='.' يعني أن Flask سيبحث عن قوالب HTML (مثل claud.html) في نفس مجلد app.py

@app.route('/')
def index():
    """
    يخدم الصفحة الرئيسية claud.html.
    نستخدم render_template هنا لضمان أن Flask يعرف أنه ملف HTML.
    """
    return render_template('claud.html')

@app.route('/<path:filename>')
def serve_static(filename):
    """
    يخدم الملفات الثابتة الأخرى مثل style.css و script.js.
    هذا المسار ضروري إذا لم تكن الملفات في مجلد 'static' مخصص
    أو إذا كنت تريد التحكم بشكل أدق.

    في حالتنا، بما أننا عرفنا static_folder='.',
    قد لا يكون هذا المسار serve_static مطلوبًا بشكل صارم
    لـ style.css و script.js إذا تم ربطهما بشكل صحيح في HTML،
    ولكن من الجيد وجوده كمعالج عام.
    """
    return send_from_directory('.', filename)

if __name__ == '__main__':
    # تحديد المنفذ، يمكن تغييره إذا كان 5000 مستخدماً
    port = int(os.environ.get('PORT', 5000))
    # app.run(debug=True) يسهل التطوير لأنه يعيد تحميل الخادم عند التغييرات
    # ولكن في "الإنتاج" الفعلي، يجب استخدام خادم WSGI مثل Gunicorn أو Waitress.
    # host='0.0.0.0' يجعل الخادم متاحًا على جميع واجهات الشبكة (ليس فقط localhost)
    app.run(host='0.0.0.0', port=port, debug=True)