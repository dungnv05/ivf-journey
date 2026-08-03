import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, XCircle } from 'lucide-react';
import './DietPage.css';

function DietPage() {
  return (
    <div className="diet-page-container">
      <Link to="/" className="back-button" style={{ 
        position: 'fixed', 
        left: '1rem', 
        top: '1rem', 
        zIndex: 100,
        display: 'flex', 
        alignItems: 'center', 
        gap: '0.5rem', 
        color: 'var(--primary)', 
        textDecoration: 'none', 
        fontWeight: 'bold',
        backgroundColor: 'white',
        padding: '0.75rem 1.25rem',
        borderRadius: '2rem',
        boxShadow: '0 4px 15px rgba(0,0,0,0.1)',
        transition: 'transform 0.2s'
      }}>
        <ArrowLeft size={20} />
        Quay lại Hành trình
      </Link>
      
      <header className="header" style={{ marginBottom: '3rem', position: 'relative' }}>
        <h1 className="title" style={{ marginTop: '1rem' }}>Chế Độ Ăn Uống IVF</h1>
        <p className="subtitle">
          Cẩm nang dinh dưỡng toàn diện: Những thực phẩm "Vàng" cần tăng cường và "Đỏ" cần tuyệt đối tránh trong suốt hành trình IVF và thai kỳ.
        </p>
      </header>

      <main className="diet-content">
        <section className="diet-section dos-section">
          <div className="section-header dos-header">
            <CheckCircle2 size={32} color="#10b981" />
            <h2>Thực Phẩm "Vàng" (Nên Ăn)</h2>
          </div>
          
          <div className="diet-grid">
            <div className="diet-card">
              <h3>Đạm Sạch (Protein)</h3>
              <p>Rất quan trọng trong giai đoạn kích trứng và nuôi thai:</p>
              <ul>
                <li><strong>Thịt bò thăn, ức gà:</strong> Cung cấp sắt và đạm xây dựng mô phôi thai.</li>
                <li><strong>Cá biển sâu:</strong> Cá hồi, cá trích chứa nhiều Omega-3 giảm viêm, tốt cho não bộ thai nhi (ăn tối đa 2 bữa/tuần để tránh thủy ngân).</li>
                <li><strong>Lòng trắng trứng gà:</strong> Giúp chống quá kích buồng trứng cực kỳ hiệu quả sau khi chọc hút.</li>
              </ul>
            </div>
            
            <div className="diet-card">
              <h3>Tinh Bột Chậm (Complex Carbs)</h3>
              <p>Phòng ngừa tiểu đường thai kỳ và cung cấp năng lượng ổn định:</p>
              <ul>
                <li><strong>Gạo lứt, yến mạch:</strong> Chứa nhiều vitamin B và chất xơ.</li>
                <li><strong>Khoai lang:</strong> Tuyệt vời để chống táo bón do dùng thuốc nội tiết Progesterone.</li>
                <li><strong>Các loại đậu (đậu đen, đậu đỏ):</strong> Chứa nhiều axit folic tự nhiên.</li>
              </ul>
            </div>
            
            <div className="diet-card">
              <h3>Chất Béo Tốt & Vitamin</h3>
              <p>Hỗ trợ niêm mạc tử cung và nội tiết:</p>
              <ul>
                <li><strong>Quả bơ:</strong> Chứa chất béo đơn không bão hòa, cực kỳ tốt cho niêm mạc tử cung trước chuyển phôi.</li>
                <li><strong>Các loại hạt khô:</strong> Óc chó, hạnh nhân, macca, hạt bí (ngừa dị tật ống thần kinh).</li>
                <li><strong>Rau xanh đậm:</strong> Cải bó xôi, súp lơ xanh dồi dào canxi và folate.</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="diet-section donts-section">
          <div className="section-header donts-header">
            <XCircle size={32} color="#ef4444" />
            <h2>Thực Phẩm "Đỏ" (Tuyệt Đối Tránh)</h2>
          </div>
          
          <div className="diet-grid">
            <div className="diet-card danger-card">
              <h3>Thực phẩm gây co bóp tử cung</h3>
              <p>Nguy cơ gây bóc tách túi thai, sảy thai (đặc biệt trong 3 tháng đầu):</p>
              <ul>
                <li><strong>Đu đủ xanh, rau ngót:</strong> Chứa enzyme papain, papaverin gây co thắt cơ trơn dữ dội.</li>
                <li><strong>Khổ qua (Mướp đắng):</strong> Chứa charantin và vicine gây co bóp tử cung và xuất huyết.</li>
                <li><strong>Rau răm, ngải cứu, rau sam:</strong> Gây hưng phấn tử cung, dễ dẫn đến dọa sảy.</li>
              </ul>
            </div>
            
            <div className="diet-card danger-card">
              <h3>Nguy cơ Nhiễm khuẩn</h3>
              <p>Gây ngộ độc thực phẩm, nhiễm ký sinh trùng qua thai nhi:</p>
              <ul>
                <li><strong>Thịt, cá, trứng chưa chín kỹ:</strong> Gỏi cá, sushi, trứng ốp la lòng đào, bít tết tái (nguy cơ nhiễm Listeria, Salmonella, Toxoplasma).</li>
                <li><strong>Sữa chưa tiệt trùng:</strong> Phô mai mềm làm từ sữa sống.</li>
                <li><strong>Rau mầm sống:</strong> Thường chứa vi khuẩn E.coli khó rửa sạch.</li>
              </ul>
            </div>
            
            <div className="diet-card danger-card">
              <h3>Thực phẩm gây viêm & Độc tố</h3>
              <p>Suy giảm chất lượng trứng, dễ gây tiểu đường thai kỳ:</p>
              <ul>
                <li><strong>Đường tinh luyện:</strong> Trà sữa, bánh kẹo, nước ngọt có ga.</li>
                <li><strong>Thức ăn đóng hộp, chế biến sẵn:</strong> Xúc xích, thịt xông khói chứa nhiều nitrat bảo quản.</li>
                <li><strong>Cafein:</strong> Hạn chế dưới 200mg/ngày. Tuyệt đối không rượu bia và thuốc lá.</li>
              </ul>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default DietPage;
